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
import { usePlugin } from '@/main';
import AssetsManager from './components/AssetsManager.vue';
import ImageEditorDialog from './components/ImageEditorDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import { getAssetInfoByName, deleteAssetFile, type AssetInfo } from './utils/siyuan-db';
import { saveAssetFile, renameAssetFile, dataURLToBlob, saveOriginalImage, readAssetFile } from './utils/file-system';
import { replaceAssetInBlocks, setImageBlockReEditData } from './utils/siyuan-block';
import { buildEditedAssetName, resolveRenameAssetName } from './utils/asset-actions';
import { showConfirm } from './utils/confirm';
import { pushMsg } from './api';
import { error } from './utils/logger';
import type { IAssetReEditMetadata } from './types/reedit';

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

onMounted(() => {
  // 注册顶栏按钮，点击时打开资源管家
  plugin.addTopBar({
    icon: 'iconAssetsManager',
    title: '资源管家',
    callback: () => {
      visible.value = !visible.value;
    },
  });
  
  // 暴露给外部控制
  (window as any)._siyuan_assets_manager_toggle = () => {
    visible.value = !visible.value;
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
  const { oldName, dataUrl, blockId, vectorData, isReEditMode, originalStoragePath, originalSize } = payload;
  const newName = buildEditedAssetName(oldName);
  
  try {
    const blob = dataURLToBlob(dataUrl);
    
    // 1. 物理保存新渲染的位图文件至 data/assets/
    await saveAssetFile(blob, newName);
    
    // 2. 异步获取旧图片的 AssetInfo 并联动更新引用
    const assetRecord = await getAssetInfoByName(oldName);
    if (assetRecord && assetRecord.references && assetRecord.references.length > 0) {
      await replaceAssetInBlocks(assetRecord.references, oldName, newName);
    }

    // 3. 收集所有目标 Block ID（包括传入的 blockId 以及所有引用了该图片的 blocks）
    const targetBlockIds = new Set<string>();
    if (blockId) {
      targetBlockIds.add(blockId);
    }
    if (assetRecord && assetRecord.references) {
      for (const ref of assetRecord.references) {
        if (ref.id) {
          targetBlockIds.add(ref.id);
        }
      }
    }

    // 4. 处理原始底图持久化与块自定义属性 custom-asset-reedit
    if (targetBlockIds.size > 0) {
      let finalOriginalPath = originalStoragePath || '';

      // 如果尚未保存过隔离底图（首次编辑），将原图安全归档到 storage/originals/
      if (!finalOriginalPath) {
        try {
          const originalBlob = await readAssetFile(oldName);
          if (originalBlob) {
            finalOriginalPath = await saveOriginalImage(originalBlob, oldName);
          }
        } catch (origErr) {
          error("归档原始底图失败:", origErr);
        }
      }

      // 如果有可用的原始底图路径，写入 custom-asset-reedit 块属性
      if (finalOriginalPath) {
        const metadata: IAssetReEditMetadata = {
          version: 1,
          originalStoragePath: finalOriginalPath,
          renderedAssetName: newName,
          canvasSize: {
            width: originalSize?.width || 800,
            height: originalSize?.height || 600,
          },
          compressed: false,
          vectorData: vectorData || { objects: [] },
          updatedAt: Date.now(),
        };

        // 短暂缓冲 100ms，确保思源内核 updateBlock 事务完全提交后再写入 setBlockAttrs
        await new Promise((r) => setTimeout(r, 100));

        for (const bId of targetBlockIds) {
          await setImageBlockReEditData(bId, metadata);
        }
      }
    }
    
    // 4. 询问是否删除旧图片
    let delOld = true;
    const pluginInstance = usePlugin() as any;
    if (pluginInstance?.settings?.promptOnDeleteOriginal) {
      delOld = await showConfirm({
        title: '删除原文件',
        message: `图片已保存为 ${newName} 且引用已更新。\n是否将旧图片 ${oldName} 放入回收站？`,
        confirmText: '放入回收站',
        danger: true
      });
    }
    if (delOld) {
      await deleteAssetFile(oldName);
    }
    
    pushMsg("编辑已成功保存并同步到所有引用文档！");
    
    // 5. 通知资源管家刷新数据
    window.dispatchEvent(new CustomEvent('assets-manager-refresh'));
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
  const oldName = asset.name;

  const renameResult = await resolveRenameAssetName(oldName, globalRenameNewName.value, async (oldExt, newExt) => {
    return await showConfirm({
      title: '修改文件后缀名',
      message: `检测到您修改了文件后缀，确定要从 ${oldExt} 修改为 ${newExt} 吗？`,
      confirmText: '确认修改',
      danger: true
    });
  });

  if (renameResult.ok && !renameResult.changed) {
    closeGlobalRenameDialog();
    return;
  }
  if (!renameResult.ok && renameResult.reason === 'empty') {
    pushMsg("文件名不能为空");
    return;
  }
  if (!renameResult.ok && renameResult.reason === 'invalidChars') {
    pushMsg("文件名不能包含字符: \\ / : * ? \" < > |");
    return;
  }
  if (!renameResult.ok) {
    return;
  }
  
  const newName = renameResult.name;

  closeGlobalRenameDialog();
  try {
    let deleteOld = true;
    const plugin = usePlugin() as any;
    if (plugin?.settings?.promptOnDeleteOriginal) {
      deleteOld = await showConfirm({
        title: '删除原文件',
        message: `文件已重命名为 ${newName}。\n是否将原文件 ${oldName} 放入回收站？`,
        confirmText: '放入回收站',
        danger: true
      });
    }

    // 1. 重命名物理文件
    const success = await renameAssetFile(oldName, newName, deleteOld);
    if (!success) {
      pushMsg("重命名物理文件失败");
      return;
    }

    // 2. 联动更新文档中该资源的引用并同步修改内存数据
    if (asset.references && asset.references.length > 0) {
      await replaceAssetInBlocks(asset.references, oldName, newName);
    }

    if (asset.references && asset.references.length > 0) {
      pushMsg(`重命名成功！已自动更新 ${asset.references.length} 个文档引用`);
    } else {
      pushMsg("重命名成功！");
    }

    // 3. 通知资源管家刷新数据
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
  width: 100vw;
  height: 100dvh;
  max-height: 100vh;
  position: absolute;
  top: 0px;
  left: 0px;
  pointer-events: none;
  box-sizing: border-box;
  z-index: 200; /* 提升根容器层级 */
}
</style>
