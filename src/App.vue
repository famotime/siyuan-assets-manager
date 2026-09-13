<template>
  <ConfirmDialog />
  <div class="am-dialog-overlay" v-if="visible" @click.self="closeManager">
    <div class="am-dialog manager-dialog">
      <button class="am-dialog__close" style="position: absolute; top: 16px; right: 16px; z-index: 10;" @click="closeManager" aria-label="关闭">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
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
  <div v-if="globalRenameVisible && globalRenameAsset" class="am-dialog-overlay" style="z-index: 1100;">
    <div class="am-dialog" style="width: 400px; max-width: 90vw;">
      <div class="am-dialog__header">
        <h3>重命名资源</h3>
        <button class="am-dialog__close" @click="closeGlobalRenameDialog" aria-label="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="am-dialog__body">
        <div style="margin-bottom: 12px; color: var(--b3-theme-on-surface-light); word-break: break-all; font-size: 13px;">
          原文件名: <strong>{{ globalRenameAsset.name }}</strong>
        </div>
        <div class="form-item">
          <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 13px;">新文件名 (需保留相同的后缀名):</label>
          <input 
            v-model="globalRenameNewName" 
            type="text" 
            class="am-input" 
            style="width: 100%;"
            @keyup.enter="submitGlobalRename"
          />
        </div>
      </div>
      <div class="am-dialog__footer">
        <button class="am-btn am-btn--ghost" @click="closeGlobalRenameDialog">取消</button>
        <button class="am-btn am-btn--primary" @click="submitGlobalRename">确认修改</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { openTab } from 'siyuan';
import { usePlugin } from '@/main';
import { ASSETS_MANAGER_TAB_TYPE } from './index';
import AssetsManager from './components/AssetsManager.vue';
import ImageEditorDialog from './components/ImageEditorDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import { getAssetInfoByName, type AssetInfo } from './utils/siyuan-db';
import { executeSaveEditedAssetWorkflow, executeRenameAssetWorkflow } from './utils/asset-workflow';
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
const globalRenameNewName = ref('');

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
        title: pluginInstance.i18n?.addTopBarIcon || '资源管家',
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
      title: '资源管家',
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

  // 暴露全局重命名方法
  (window as any)._siyuan_assets_manager_open_rename = async (assetName: string) => {
    pushMsg("正在获取资源引用，请稍候...", 2000);
    try {
      const assetInfo = await getAssetInfoByName(assetName);
      if (assetInfo) {
        globalRenameAsset.value = assetInfo;
        globalRenameNewName.value = assetInfo.name;
        globalRenameVisible.value = true;
      } else {
        pushMsg("获取资源失败", 3000);
      }
    } catch (e) {
      error(e);
      pushMsg("获取资源引用失败", 3000);
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
          title: '删除原文件',
          message: `图片已保存为 ${newName} 且引用已更新。\n是否将旧图片 ${oldName} 放入回收站？`,
          confirmText: '放入回收站',
          danger: true,
        });
      },
    });

    if (result.success) {
      pushMsg("编辑已成功保存并同步到所有引用文档！");
      window.dispatchEvent(new CustomEvent('assets-manager-refresh'));
    }
  } catch (e) {
    error("Failed to save edited image:", e);
    pushMsg("保存编辑失败");
  }
}

// 全局重命名弹窗控制
function closeGlobalRenameDialog() {
  globalRenameVisible.value = false;
  globalRenameAsset.value = null;
  globalRenameNewName.value = '';
}

async function submitGlobalRename() {
  if (!globalRenameAsset.value) return;
  const asset = globalRenameAsset.value;
  const pluginInstance = usePlugin() as any;

  try {
    const result = await executeRenameAssetWorkflow({
      asset,
      newNameInput: globalRenameNewName.value,
      promptOnDeleteOriginal: Boolean(pluginInstance?.settings?.promptOnDeleteOriginal),
      onConfirmExtChange: async (oldExt, newExt) => {
        return await showConfirm({
          title: '修改文件后缀名',
          message: `检测到您修改了文件后缀，确定要从 ${oldExt} 修改为 ${newExt} 吗？`,
          confirmText: '确认修改',
          danger: true,
        });
      },
      onConfirmDelete: async (oldName, newName) => {
        return await showConfirm({
          title: '删除原文件',
          message: `文件已重命名为 ${newName}。\n是否将原文件 ${oldName} 放入回收站？`,
          confirmText: '放入回收站',
          danger: true,
        });
      },
    });

    if (!result.ok) {
      if (result.reason === 'empty') {
        pushMsg("文件名不能为空");
      } else if (result.reason === 'invalidChars') {
        pushMsg("文件名不能包含字符: \\ / : * ? \" < > |");
      } else if (result.reason === 'fileSystemError') {
        pushMsg("重命名物理文件失败");
      }
      return;
    }

    closeGlobalRenameDialog();

    if (!result.changed) {
      return;
    }

    if ((result.updatedBlockCount || 0) > 0) {
      pushMsg(`重命名成功！已自动更新 ${result.updatedBlockCount} 个文档引用`);
    } else {
      pushMsg("重命名成功！");
    }

    window.dispatchEvent(new CustomEvent('assets-manager-refresh'));
  } catch (e) {
    error("Failed to rename asset", e);
    pushMsg("重命名操作失败");
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
  z-index: 200 !important;
}
</style>
