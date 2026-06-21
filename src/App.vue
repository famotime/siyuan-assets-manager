<template>
  <div class="plugin-app-main" v-if="visible">
    <div class="manager-dialog">
      <div class="dialog-close-btn" @click="closeManager">
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </div>
      <AssetsManager />
    </div>
  </div>

  <!-- 全局图片编辑器弹窗 -->
  <ImageEditorDialog 
    v-model:visible="globalEditorVisible"
    :assetName="globalEditorAssetName"
    @save-edited="handleGlobalSaveEdited"
  />

  <!-- 全局重命名弹窗 -->
  <div v-if="globalRenameVisible && globalRenameAsset" class="rename-dialog-overlay">
    <div class="rename-dialog-content">
      <div class="rename-dialog-header">
        <h3>重命名资源</h3>
        <button class="close-btn" @click="closeGlobalRenameDialog">×</button>
      </div>
      <div class="rename-dialog-body">
        <div style="margin-bottom: 12px; color: var(--b3-theme-on-surface-light); word-break: break-all; font-size: 13px;">
          原文件名: <strong>{{ globalRenameAsset.name }}</strong>
        </div>
        <div class="form-item">
          <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 13px;">新文件名 (需保留相同的后缀名):</label>
          <input 
            v-model="globalRenameNewName" 
            type="text" 
            class="b3-text-field" 
            style="width: 100%; box-sizing: border-box;"
            @keyup.enter="submitGlobalRename"
          />
        </div>
      </div>
      <div class="rename-dialog-footer">
        <button class="b3-button b3-button--cancel" @click="closeGlobalRenameDialog">取消</button>
        <button class="b3-button b3-button--primary" @click="submitGlobalRename">确认修改</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { usePlugin } from '@/main';
import AssetsManager from './components/AssetsManager.vue';
import ImageEditorDialog from './components/ImageEditorDialog.vue';
import { getAssetInfoByName, deleteAssetFile, type AssetInfo } from './utils/siyuan-db';
import { saveAssetFile, renameAssetFile } from './utils/file-system';
import { replaceAssetInBlocks } from './utils/siyuan-block';
import { pushMsg } from './api';

const visible = ref(false);
const plugin = usePlugin();

// 全局编辑器状态
const globalEditorVisible = ref(false);
const globalEditorAssetName = ref('');

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

  // 暴露全局图片编辑方法
  (window as any)._siyuan_assets_manager_open_editor = (assetName: string) => {
    globalEditorAssetName.value = assetName;
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
      console.error(e);
      pushMsg("获取资源引用失败", 3000);
    }
  };
});

function closeManager() {
  visible.value = false;
}

// 全局保存编辑逻辑
async function handleGlobalSaveEdited(payload: { oldName: string, dataUrl: string }) {
  const { oldName, dataUrl } = payload;
  
  const ext = oldName.split('.').pop();
  const baseName = oldName.substring(0, oldName.lastIndexOf('.'));
  const timestamp = Date.now();
  const newName = `${baseName}_edited_${timestamp}.${ext || 'png'}`;
  
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    
    // 1. 物理保存新文件
    await saveAssetFile(blob, newName);
    
    // 2. 异步获取旧图片的 AssetInfo 并联动更新引用
    const assetRecord = await getAssetInfoByName(oldName);
    if (assetRecord && assetRecord.references && assetRecord.references.length > 0) {
      await replaceAssetInBlocks(assetRecord.references, oldName, newName);
    }
    
    // 3. 询问是否删除旧图片
    const delOld = window.confirm(`图片已保存为 ${newName} 且引用已更新。\n是否将旧图片 ${oldName} 放入回收站？`);
    if (delOld) {
      await deleteAssetFile(oldName);
    }
    
    pushMsg("编辑已成功保存并同步到所有引用文档！");
    
    // 4. 通知资源管家刷新数据
    window.dispatchEvent(new CustomEvent('assets-manager-refresh'));
  } catch (e) {
    console.error("Failed to save edited image:", e);
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
  const oldExtIdx = oldName.lastIndexOf('.');
  const oldExt = oldExtIdx <= 0 ? '' : oldName.slice(oldExtIdx);
  
  let newName = globalRenameNewName.value.trim();
  if (newName === oldName) {
    closeGlobalRenameDialog();
    return;
  }
  if (!newName) {
    pushMsg("文件名不能为空");
    return;
  }

  // 非法字符校验 \ / : * ? " < > |
  const invalidChars = /[\\/:*?"<>|]/;
  if (invalidChars.test(newName)) {
    pushMsg("文件名不能包含字符: \\ / : * ? \" < > |");
    return;
  }

  // 后缀名验证
  const newExtIdx = newName.lastIndexOf('.');
  const newExt = newExtIdx <= 0 ? '' : newName.slice(newExtIdx);
  
  if (newExt !== oldExt) {
    if (newExt) {
      const confirmExt = window.confirm(`检测到您修改了文件后缀，确定要从 ${oldExt} 修改为 ${newExt} 吗？`);
      if (!confirmExt) return;
    } else {
      // 自动补齐后缀
      newName = newName + oldExt;
    }
  }

  closeGlobalRenameDialog();
  try {
    // 1. 重命名物理文件
    const success = await renameAssetFile(oldName, newName);
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
    console.error("Failed to rename asset", e);
    pushMsg("重命名操作失败");
  }
}
</script>

<style lang="scss" scoped>
.plugin-app-main {
  width: 100vw;
  height: 100vh;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 100; /* 高层级覆盖 */
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.4); /* 半透明遮罩 */
  pointer-events: auto;
}

.manager-dialog {
  width: 90vw;
  height: 90vh;
  background-color: var(--b3-theme-background);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.dialog-close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  cursor: pointer;
  color: var(--b3-theme-on-surface);
  z-index: 10;
  padding: 4px;
  border-radius: 4px;
  transition: background-color 0.2s;
  
  &:hover {
    background-color: var(--b3-theme-surface-lighter);
  }
}

/* 全局重命名弹窗 */
.rename-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1100;
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: auto;
}
.rename-dialog-content {
  background: var(--b3-theme-background);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;
  width: 400px;
  max-width: 90vw;
  overflow: hidden;
}
.rename-dialog-header {
  padding: 16px;
  border-bottom: 1px solid var(--b3-theme-surface-lighter);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.rename-dialog-header h3 {
  margin: 0;
  color: var(--b3-theme-on-background);
}
.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--b3-theme-on-surface);
  line-height: 1;
}
.rename-dialog-body {
  padding: 16px;
}
.rename-dialog-footer {
  padding: 16px;
  border-top: 1px solid var(--b3-theme-surface-lighter);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>

<style lang="scss">
.plugin-sample-vite-vue-app {
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