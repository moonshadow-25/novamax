import fs from 'fs';
import path from 'path';

const SIZE_TOLERANCE = 0.01; // 1% 容差

/**
 * 检查一组文件是否都存在且大小匹配（底层原语）
 * @param {string} dir - 文件所在目录
 * @param {Array<{filename: string, size?: number}>} files - 待检查的文件列表
 * @returns {boolean} true = 全部完整，false = 有文件缺失或大小不符
 */
export function checkFilesComplete(dir, files) {
  for (const file of files) {
    const filePath = path.join(dir, file.filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`[integrity] 文件不存在: ${file.filename}`);
      return false;
    }
    if (file.size) {
      const actualSize = fs.statSync(filePath).size;
      if (Math.abs(actualSize - file.size) / file.size > SIZE_TOLERANCE) {
        console.warn(`[integrity] 文件大小不符: ${file.filename} 期望=${file.size} 实际=${actualSize}`);
        return false;
      }
    }
  }
  return true;
}

/**
 * 检查模型激活文件（及所有分片）是否完整，用于决定显示"启动"还是"下载"按钮
 * @param {object} model - 含 downloaded_files 和 local_path 的模型对象
 * @returns {boolean} true = 完整可启动，false = 文件缺失或损坏
 */
export function checkActiveFileIntegrity(model) {
  const downloadedFiles = model.downloaded_files || [];
  const activeFile = downloadedFiles.find(f => f.is_active);
  if (!activeFile || !model.local_path) return false;

  // 取同一量化版本的所有文件（处理多分片模型，如 00001-of-00003）
  const relatedFiles = downloadedFiles.filter(f => f.matched_preset === activeFile.matched_preset);
  const filesToCheck = relatedFiles.length > 0 ? relatedFiles : [activeFile];

  return checkFilesComplete(model.local_path, filesToCheck);
}

/**
 * 检查指定量化版本的文件是否不完整，用于决定是否允许重新下载
 * @param {string} modelDir - 模型文件目录
 * @param {object} quantInfo - 量化版本配置对象
 * @param {object} model - 含 downloaded_files 的模型对象
 * @returns {boolean} true = 不完整需重新下载，false = 完整无需下载
 */
export function isQuantizationIncomplete(modelDir, quantInfo, model) {
  if (!quantInfo) {
    // 找不到量化配置，无法校验，视为完整（不重复下载）
    return false;
  }

  if (quantInfo.is_folder && quantInfo.folder_files?.length > 0) {
    // 多文件夹量化：用配置中的 folder_files（含每个子文件的名称和大小）
    const files = quantInfo.folder_files.map(f => ({ filename: f.name, size: f.size }));
    return !checkFilesComplete(modelDir, files);
  }

  // 普通 gguf 量化（含多分片）：用 downloaded_files 中的实际记录
  // 注意：使用 fileRecord.size（下载时记录的每个分片实际大小），
  // 而非 quantInfo.total_size（整个量化版本总大小），避免分片模型误判
  const downloadedFiles = model.downloaded_files || [];
  const matchedFiles = downloadedFiles.filter(f => f.matched_preset === quantInfo.name);

  if (matchedFiles.length === 0) {
    return true; // 没有下载记录，视为不完整
  }

  return !checkFilesComplete(modelDir, matchedFiles);
}
