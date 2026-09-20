/**
 * SiYuan Kernel API 封装
 * 仅保留资源管家插件实际使用的核心接口
 * 
 * 详见 SiYuan API 文档: https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md
 */

import { fetchSyncPost, IWebSocketData } from "siyuan";

async function request(url: string, data: any): Promise<any> {
  const response: IWebSocketData = await fetchSyncPost(url, data);
  if (response.code !== 0) {
    console.warn(`[API ${url}] 请求返回非 0 状态:`, response.msg, response);
    return null;
  }
  return response.data !== undefined ? response.data : {};
}

// **************************************** SQL 查询 ****************************************
export async function sql(sqlStmt: string): Promise<any[]> {
  const url = "/api/query/sql";
  return request(url, { stmt: sqlStmt });
}

// **************************************** 通知推送 ****************************************
export async function pushMsg(msg: string, timeout: number = 7000): Promise<any> {
  const url = "/api/notification/pushMsg";
  return request(url, { msg, timeout });
}

// **************************************** 文件系统 ****************************************
export async function readDir(path: string): Promise<IResReadDir[]> {
  const url = "/api/file/readDir";
  return request(url, { path });
}

export async function putFile(
  path: string,
  isDir: boolean = false,
  file: any = undefined
): Promise<any> {
  const form = new FormData();
  form.append("path", path);
  form.append("isDir", isDir.toString());
  form.append("modTime", Math.floor(Date.now() / 1000).toString());
  if (file) {
    form.append("file", file);
  }
  const url = "/api/file/putFile";
  return fetchSyncPost(url, form);
}

export async function removeFile(path: string): Promise<any> {
  const url = "/api/file/removeFile";
  return request(url, { path });
}

// **************************************** 块操作 ****************************************
export async function updateBlock(
  dataType: "markdown" | "dom",
  data: string,
  id: BlockId
): Promise<any> {
  const url = "/api/block/updateBlock";
  return request(url, { dataType, data, id });
}

export async function deleteBlock(id: BlockId): Promise<any> {
  const url = "/api/block/deleteBlock";
  return request(url, { id });
}

export async function insertBlock(
  dataType: "markdown" | "dom",
  data: string,
  options: {
    nextID?: string;
    previousID?: string;
    parentID?: string;
  }
): Promise<any> {
  const url = "/api/block/insertBlock";
  return request(url, {
    dataType,
    data,
    nextID: options.nextID || "",
    previousID: options.previousID || "",
    parentID: options.parentID || "",
  });
}

// **************************************** 块属性 ****************************************
export async function getBlockAttrs(id: BlockId): Promise<{ [key: string]: string }> {
  const url = "/api/attr/getBlockAttrs";
  return request(url, { id });
}

export async function setBlockAttrs(
  id: BlockId,
  attrs: { [key: string]: string }
): Promise<any> {
  const url = "/api/attr/setBlockAttrs";
  return request(url, { id, attrs });
}

// **************************************** 块详情 (Kramdown) ****************************************
export async function getBlockKramdown(id: BlockId): Promise<{ id: string; kramdown: string } | null> {
  const url = "/api/block/getBlockKramdown";
  return request(url, { id });
}

// **************************************** 数据库事务同步 ****************************************
/**
 * 强制思源内核立即将未落盘的内存事务和 SQLite 异步写入队列同步刷新进数据库
 * 避免在 updateBlock 后立即进行 SQL 查库时因 3 秒批处理队列时延导致读到脏数据
 */
export async function flushTransaction(): Promise<any> {
  const url = "/api/sqlite/flushTransaction";
  return request(url, {});
}

// **************************************** 笔记本 ****************************************
export async function lsNotebooks(): Promise<IReslsNotebooks> {
  const url = "/api/notebook/lsNotebooks";
  return request(url, {});
}

