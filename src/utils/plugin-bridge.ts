import { pushErrMsg } from "../api";

/**
 * 与 siyuan-image-quickedit 插件交互的桥接器
 */

export async function isQuickEditInstalled(): Promise<boolean> {
  try {
    // 思源笔记中获取已安装插件列表的 API 为 /api/bazaar/getInstalledPlugin
    // 由于该 API 未公开定义在我们的模板里，我们可以通过发送网络请求尝试检查
    const response = await fetch("/api/bazaar/getInstalledPlugin", {
      method: "POST",
      body: JSON.stringify({ frontend: "desktop", keyword: "" })
    });
    const result = await response.json();
    if (result && result.data && result.data.plugins) {
      const plugins = result.data.plugins;
      return plugins.some((p: any) => p.name === "siyuan-image-quickedit");
    }
  } catch (e) {
    console.error("Failed to check installed plugins", e);
  }
  return false;
}

/**
 * 触发图片压缩
 * @param assetName 资源文件名
 */
export async function triggerImageCompression(assetName: string): Promise<void> {
  const installed = await isQuickEditInstalled();
  if (!installed) {
    pushErrMsg("未检测到 siyuan-image-quickedit 插件，请先安装该插件！");
    return;
  }
  
  // 发送自定义事件或调用全局方法触发 siyuan-image-quickedit 的处理逻辑
  // 假设它监听了 "quickedit-compress-asset" 事件，或者我们在未来将与作者协商添加这个 API
  const event = new CustomEvent("quickedit-compress-asset", {
    detail: { asset: assetName }
  });
  window.dispatchEvent(event);
  
  console.log(`Triggered compression for ${assetName}`);
}
