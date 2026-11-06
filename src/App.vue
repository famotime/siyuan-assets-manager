<template>
  <ConfirmDialog />
  <div class="am-dialog-overlay" v-if="visible" @click.self="closeManager">
    <div class="am-dialog manager-dialog">
      <button class="am-dialog__close b3-tooltips b3-tooltips__sw" style="position: absolute; top: 16px; right: 16px; z-index: 10;" @click="closeManager" :aria-label="t('app.closeWindowEsc')">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="fill: none !important;">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <AssetsManager />
    </div>
  </div>

  <!-- 全局图片编辑器弹窗 -->
  <ImageEditorDialog 
    v-model:visible="globalEditorVisible"
    :assetName="globalEditorAssetName"
    :blockId="globalEditorBlockId"
    @save-edited="handleGlobalSaveEdited"
  />

  <!-- 全局重命名弹窗 -->
  <div v-if="globalRenameVisible && globalRenameAsset" class="am-dialog-overlay" style="z-index: 1100;" @click.self="closeGlobalRenameDialog">
    <div class="am-dialog" style="width: 420px; max-width: 90vw;">
      <div class="am-dialog__header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <FileEdit :size="18" style="fill: none !important; color: var(--b3-theme-primary);" />
          <h3 style="margin: 0;">{{ t('app.renameAssetTitle') }}</h3>
        </div>
        <button class="am-dialog__close b3-tooltips b3-tooltips__sw" @click="closeGlobalRenameDialog" :aria-label="t('app.closeWindowEsc')">
          <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" style="fill: none !important;">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="am-dialog__body">
        <div style="margin-bottom: 12px; color: var(--b3-theme-on-surface-light); word-break: break-all; font-size: 13px;">
          {{ t('app.originalFileName') }} <strong>{{ globalRenameAsset.name }}</strong>
        </div>
        <div class="form-item">
          <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 13px;">{{ t('app.newFileName') }}</label>
          <div class="am-input-group">
            <input 
              ref="renameInputRef"
              v-model="globalRenameBaseName" 
              type="text" 
              class="am-input" 
              :placeholder="t('app.newFileNamePlaceholder')"
              autofocus
              @keyup.enter="submitGlobalRename"
            />
            <span v-if="globalRenameExt" class="am-input-group__addon">.{{ globalRenameExt }}</span>
          </div>
        </div>
      </div>
      <div class="am-dialog__footer">
        <button class="am-btn am-btn--ghost b3-tooltips b3-tooltips__n" @click="closeGlobalRenameDialog" :aria-label="t('app.cancelRenameEsc')" style="display: inline-flex; align-items: center; gap: 4px;">
          <X :size="14" style="fill: none !important;" />
          <span>{{ t('common.cancel') }}</span>
        </button>
        <button class="am-btn am-btn--primary b3-tooltips b3-tooltips__n" @click="submitGlobalRename" :aria-label="t('app.confirmRenameAria')" style="display: inline-flex; align-items: center; gap: 4px;">
          <Check :size="14" style="fill: none !important;" />
          <span>{{ t('app.confirmChange') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { openTab } from 'siyuan';
import { FileEdit, X, Check } from 'lucide-vue-next';
import { usePlugin } from '@/main';
import { t } from '@/i18n';
import { ASSETS_MANAGER_TAB_TYPE } from './index';
import AssetsManager from './components/AssetsManager.vue';
import ImageEditorDialog from './components/ImageEditorDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import { getAssetInfoByName, type AssetInfo } from './utils/siyuan-db';
import { executeSaveEditedAssetWorkflow, executeRenameAssetWorkflow } from './utils/asset-workflow';
import { splitFileName } from './utils/asset-list';
import { showConfirm } from './utils/confirm';
import { pushMsg } from './api';
import { error } from './utils/logger';

const visible = ref(false);
const plugin = usePlugin();

// 全局编辑器状态
const globalEditorVisible = ref(false);
const globalEditorAssetName = ref('');
const globalEditorBlockId = ref<string | undefined>(undefined);

// 全局重命名状态
const globalRenameVisible = ref(false);
const globalRenameAsset = ref<AssetInfo | null>(null);
const globalRenameBaseName = ref('');
const globalRenameExt = ref('');
const renameInputRef = ref<HTMLInputElement | null>(null);

function handleGlobalRenameKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeGlobalRenameDialog();
  }
}

watch(globalRenameVisible, (val) => {
  if (val) {
    window.addEventListener('keydown', handleGlobalRenameKeyDown, true);
    nextTick(() => {
      if (renameInputRef.value) {
        renameInputRef.value.focus();
        renameInputRef.value.select();
      }
    });
  } else {
    window.removeEventListener('keydown', handleGlobalRenameKeyDown, true);
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalRenameKeyDown, true);
});

const handleToggleAssetsManager = () => {
  const pluginInstance = plugin as any;
  if (pluginInstance?.settings?.openInTab) {
    if (visible.value) {
      visible.value = false;
    }
    openTab({
      app: pluginInstance.app,
      custom: {
        icon: 'iconAssetsManager',
        title: t('common.appTitle'),
        id: pluginInstance.name + ASSETS_MANAGER_TAB_TYPE,
      },
    });
  } else {
    visible.value = !visible.value;
  }
};

onMounted(() => {
  // 注册顶栏按钮，点击时打开资源管家
  if (typeof plugin?.addTopBar === 'function') {
    plugin.addTopBar({
      icon: 'iconAssetsManager',
      title: t('common.appTitle'),
      callback: () => {
        handleToggleAssetsManager();
      },
    });
  }
  
  // 暴露给外部控制
  (window as any)._siyuan_assets_manager_toggle = () => {
    handleToggleAssetsManager();
  };

  // 暴露全局图片编辑方法，支持传入 blockId
  (window as any)._siyuan_assets_manager_open_editor = (assetName: string, blockId?: string) => {
    globalEditorAssetName.value = assetName;
    globalEditorBlockId.value = blockId;
    globalEditorVisible.value = true;
  };

  // 暴露全局重命名方法（支持直接传入 AssetInfo 避免冗余二次查询）
  (window as any)._siyuan_assets_manager_open_rename = async (assetOrName: string | AssetInfo) => {
    if (typeof assetOrName === 'object' && assetOrName !== null && 'name' in assetOrName) {
      globalRenameAsset.value = assetOrName;
      const { name, ext } = splitFileName(assetOrName.name);
      globalRenameBaseName.value = name;
      globalRenameExt.value = ext;
      globalRenameVisible.value = true;
      return;
    }
    pushMsg(t('app.fetchingRefs'), 2000);
    try {
      const assetInfo = await getAssetInfoByName(assetOrName);
      if (assetInfo) {
        globalRenameAsset.value = assetInfo;
        const { name, ext } = splitFileName(assetInfo.name);
        globalRenameBaseName.value = name;
        globalRenameExt.value = ext;
        globalRenameVisible.value = true;
      } else {
        pushMsg(t('app.getAssetFailed'), 3000);
      }
    } catch (e) {
      error(e);
      pushMsg(t('app.getAssetRefsFailed'), 3000);
    }
  };
});

function closeManager() {
  visible.value = false;
}

// 全局保存编辑逻辑
async function handleGlobalSaveEdited(payload: {
  oldName: string;
  dataUrl: string;
  blockId?: string;
  vectorData?: any;
  isReEditMode?: boolean;
  originalStoragePath?: string;
  originalSize?: { width: number; height: number };
}) {
  const pluginInstance = usePlugin() as any;
  try {
    const result = await executeSaveEditedAssetWorkflow({
      ...payload,
      promptOnDeleteOriginal: Boolean(pluginInstance?.settings?.promptOnDeleteOriginal),
      onConfirmDelete: async (oldName, newName) => {
        return await showConfirm({
          title: t('app.deleteOriginalTitle'),
          message: t('app.deleteOriginalImageMsg', { newName, oldName }),
          confirmText: t('app.moveToTrash'),
          danger: true,
        });
      },
    });

    if (result.success) {
      pushMsg(t('app.editSavedSynced'));

      // 实时主动刷新当前视口中对应块的图片 DOM，破除 Chromium 内存位图缓存与视觉滞后
      try {
        const targetIds = new Set<string>();
        if (payload.blockId) targetIds.add(payload.blockId);
        if (result.references) {
          for (const r of result.references) {
            if (r.id) targetIds.add(r.id);
          }
        }
        for (const bid of targetIds) {
          const blockEls = document.querySelectorAll(`[data-node-id="${bid}"]`);
          blockEls.forEach((blockEl) => {
            const imgs = blockEl.querySelectorAll('img');
            imgs.forEach((img) => {
              const src = img.getAttribute('src') || '';
              if (src.includes(payload.oldName) || src.includes(result.newName)) {
                img.src = `/assets/${result.newName}?t=${Date.now()}`;
              }
            });
          });
        }
      } catch (domErr) {
        warn('[App] 刷新页面图片 DOM 缓存失败:', domErr);
      }

      window.dispatchEvent(new CustomEvent('assets-manager-refresh', {
        detail: {
          action: 'edit',
          oldName: payload.oldName,
          newName: result.newName,
          references: result.references || [],
          size: result.size,
          updated: result.updated,
          isReEditable: result.isReEditable,
          reEditBlockId: result.reEditBlockId,
          originalStoragePath: result.originalPathSaved,
          deletedOld: result.deletedOld,
        }
      }));
    }
  } catch (e) {
    error("Failed to save edited image:", e);
    pushMsg(t('app.saveEditFailed'));
  }
}

// 全局重命名弹窗控制
function closeGlobalRenameDialog() {
  globalRenameVisible.value = false;
  globalRenameAsset.value = null;
  globalRenameBaseName.value = '';
  globalRenameExt.value = '';
}

async function submitGlobalRename() {
  if (!globalRenameAsset.value) return;
  const asset = globalRenameAsset.value;
  const pluginInstance = usePlugin() as any;

  const trimmedBase = globalRenameBaseName.value.trim();
  if (!trimmedBase) {
    pushMsg(t('app.fileNameEmpty'));
    return;
  }

  // 拼接原扩展名，确保用户仅能修改文件名主体，不可修改后缀
  const fullNewName = globalRenameExt.value ? `${trimmedBase}.${globalRenameExt.value}` : trimmedBase;

  try {
    const result = await executeRenameAssetWorkflow({
      asset,
      newNameInput: fullNewName,
      promptOnDeleteOriginal: Boolean(pluginInstance?.settings?.promptOnDeleteOriginal),
      onConfirmExtChange: async (oldExt, newExt) => {
        return await showConfirm({
          title: t('app.changeExtTitle'),
          message: t('app.changeExtMsg', { oldExt, newExt }),
          confirmText: t('app.confirmChange'),
          danger: true,
        });
      },
      onConfirmDelete: async (oldName, newName) => {
        return await showConfirm({
          title: t('app.deleteOriginalTitle'),
          message: t('app.deleteOriginalFileMsg', { newName, oldName }),
          confirmText: t('app.moveToTrash'),
          danger: true,
        });
      },
    });

    if (!result.ok) {
      if (result.reason === 'empty') {
        pushMsg(t('app.fileNameEmpty'));
      } else if (result.reason === 'invalidChars') {
        pushMsg(t('app.fileNameInvalidChars'));
      } else if (result.reason === 'fileSystemError') {
        pushMsg(t('app.renamePhysicalFailed'));
      }
      return;
    }

    closeGlobalRenameDialog();

    if (!result.changed) {
      return;
    }

    if ((result.updatedBlockCount || 0) > 0) {
      pushMsg(t('app.renameSuccessWithCount', { count: result.updatedBlockCount, n: result.updatedBlockCount }));
    } else {
      pushMsg(t('app.renameSuccess'));
    }

    window.dispatchEvent(new CustomEvent('assets-manager-refresh', {
      detail: {
        action: 'rename',
        oldName: asset.name,
        newName: result.newName,
        references: result.references || asset.references || [],
        updated: result.updated || Date.now(),
        size: result.size !== undefined ? result.size : asset.size,
        isReEditable: result.isReEditable !== undefined ? result.isReEditable : asset.isReEditable,
        reEditBlockId: result.reEditBlockId || asset.reEditBlockId,
        originalStoragePath: result.originalStoragePath || asset.originalStoragePath,
        deletedOld: result.deletedOld,
      }
    }));
  } catch (e) {
    error("Failed to rename asset", e);
    pushMsg(t('app.renameFailed'));
  }
}
</script>

<style lang="scss" scoped>
.manager-dialog {
  width: 90vw;
  height: 90vh;
  position: relative;
}
</style>

<style lang="scss">
.siyuan-assets-manager-app {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  width: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  overflow: visible !important;
  pointer-events: none !important;
  z-index: 200;
}
</style>
