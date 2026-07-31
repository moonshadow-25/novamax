/**
 * GPU 架构检测工具
 *
 * 基于 GPU 名称字符串匹配，识别 AMD RDNA 代际和 NVIDIA 计算能力。
 * 用于前端智能推荐运行时（runtime）/变体（variant）。
 */

// ── 厂商检测（独立，避免与 system.js 循环引用） ──────────────────────────────

/**
 * @param {string} gpuName
 * @returns {'nvidia'|'amd'|'intel'|'unknown'}
 */
export function detectGpuVendor(gpuName) {
  const n = (gpuName || '').toLowerCase();
  if (/nvidia|geforce|rtx|gtx|quadro|tesla/.test(n)) return 'nvidia';
  if (/amd|radeon|rx\s*\d|firepro|mi\d|instinct/.test(n)) return 'amd';
  if (/intel|arc\s*[a-z]\d|iris|uhd|hd graphics/.test(n)) return 'intel';
  return 'unknown';
}

// ── 架构映射表 ────────────────────────────────────────────────────────────────

/**
 * AMD 架构检测规则（按优先级从高到低排列，先匹配先得）
 * @type {Array<{ patterns: RegExp[], arch: string, display: string }>}
 */
const AMD_ARCH_RULES = [
  {
    // RDNA 4 (gfx120X): RX 9000 系列 + Radeon AI PRO R9600/R9700
    patterns: [
      /rx\s*90[67]0/i,
      /r\s*97\d{2}/i,
      /r\s*96\d{2}/i,
      /radeon\s*AI\s*PRO/i,
    ],
    arch: 'rdna4',
    display: 'RDNA 4',
  },
  {
    // RDNA 3.5 (gfx115X): Strix Halo / Strix Point
    patterns: [
      /80[56]0S/i,
      /8[89]0M/i,
      /ryzen\s*AI\s*Max/i,
    ],
    arch: 'rdna35',
    display: 'RDNA 3.5',
  },
  {
    // RDNA 3 (gfx110X): RX 7000 系列 + W7000 系列 + Phoenix iGPU
    patterns: [
      /rx\s*79[05]0/i,
      /rx\s*78[05]0/i,
      /rx\s*77[05]0/i,
      /rx\s*76[05]0/i,
      /w\s*79\d{2}/i,
      /w\s*78\d{2}/i,
      /w\s*77\d{2}/i,
      /7[468]0M/i,
    ],
    arch: 'rdna3',
    display: 'RDNA 3',
  },
  {
    // RDNA 2 (gfx103X): RX 6000 系列 + W6000 系列 + Rembrandt iGPU
    patterns: [
      /rx\s*6[4-9]\d{2}/i,
      /w\s*6[89]\d{2}/i,
      /w\s*66\d{2}/i,
      /6[86]0M/i,
    ],
    arch: 'rdna2',
    display: 'RDNA 2',
  },
  {
    // RDNA 1 (gfx101X): RX 5000 系列 + W5000 系列
    patterns: [/rx\s*5[3-7]\d{2}/i, /w\s*5[5-7]\d{2}/i],
    arch: 'rdna1',
    display: 'RDNA 1',
  },
];

/**
 * NVIDIA 架构检测规则
 * @type {Array<{ patterns: RegExp[], arch: string, display: string }>}
 */
const NVIDIA_ARCH_RULES = [
  {
    // RTX 50 系列 — Blackwell (compute capability 10.x)
    patterns: [/rtx\s*50[59]0/i, /rtx\s*50[678]0/i],
    arch: 'cc100',
    display: 'Blackwell (10.x)',
  },
  {
    // RTX 40 系列 — Ada Lovelace (compute capability 8.9)
    patterns: [/rtx\s*40[59]0/i, /rtx\s*40[678]0/i],
    arch: 'cc89',
    display: 'Ada Lovelace (8.9)',
  },
  {
    // RTX 30 系列 — Ampere (compute capability 8.6)
    patterns: [/rtx\s*30[59]0/i, /rtx\s*30[678]0/i, /rtx\s*3050/i],
    arch: 'cc86',
    display: 'Ampere (8.6)',
  },
  {
    // GTX 16 / RTX 20 系列 — Turing
    patterns: [/rtx\s*20[678]0/i, /gtx\s*16[56]0/i],
    arch: 'cc75',
    display: 'Turing (7.5)',
  },
];

// ── 显示名称字典（未匹配时 fallback） ─────────────────────────────────────────

const VENDOR_DISPLAY_FALLBACK = {
  amd: 'AMD',
  nvidia: 'NVIDIA',
  intel: 'Intel',
  unknown: 'Unknown',
};

// ── 公共 API ──────────────────────────────────────────────────────────────────

/**
 * 检测 GPU 架构
 * @param {string} gpuName - GPU 名称
 * @param {'nvidia'|'amd'|'intel'|'unknown'} vendor - 已检测的厂商
 * @returns {{ arch: string|null, display: string|null }}
 */
export function detectGpuArchitecture(gpuName, vendor) {
  if (!gpuName || !vendor) return { arch: null, display: null };

  const rules = vendor === 'amd' ? AMD_ARCH_RULES
    : vendor === 'nvidia' ? NVIDIA_ARCH_RULES
    : null;

  if (!rules) return { arch: null, display: null };

  for (const rule of rules) {
    if (rule.patterns.some((re) => re.test(gpuName))) {
      return { arch: rule.arch, display: rule.display };
    }
  }

  return { arch: null, display: null };
}

/**
 * 便捷方法：从 GPU 对象提取架构信息
 * @param {{ name: string, vendor?: string }} gpu
 * @returns {{ arch: string|null, display: string|null, vendor: string }}
 */
export function getGpuArchInfo(gpu) {
  if (!gpu || !gpu.name) return { arch: null, display: null, vendor: 'unknown' };

  const vendor = gpu.vendor || detectGpuVendor(gpu.name);
  const { arch, display } = detectGpuArchitecture(gpu.name, vendor);

  return {
    arch,
    display: display || VENDOR_DISPLAY_FALLBACK[vendor] || null,
    vendor,
  };
}

// ── 推荐引擎 ──────────────────────────────────────────────────────────────────

/** AMD 核显 VRAM 阈值：> 16 GB 才推荐 ROCm，否则 Vulkan */
const IGPU_ROCM_VRAM_THRESHOLD = 16 * 1024 * 1024 * 1024; // 16 GB

/**
 * 检测 AMD 核显（无 RX 前缀，型号以 M 或 S 结尾）
 */
function isIntegratedGpu(gpuName) {
  if (!gpuName) return false;
  return /\d[MS]\b/i.test(gpuName) && !/\brx\b/i.test(gpuName);
}

/**
 * 根据 GPU 信息推荐 gpu_backend
 *
 * NVIDIA → cuda
 * AMD 独显 RDNA 3+ → rocm
 * AMD 核显 RDNA 3+ → VRAM > 16GB 才 rocm，否则 vulkan
 * 老 AMD 卡 / 未知 → vulkan
 *
 * @param {{ name: string, vendor?: string, arch?: string, total?: number }} gpu
 * @param {string} engineType - 'llamacpp' | 'comfyui' | 'tts' | ...
 * @returns {'rocm'|'cuda'|'vulkan'|null}
 */
export function recommendGpuBackend(gpu, engineType) {
  const { vendor, arch } = getGpuArchInfo(gpu);

  if (vendor === 'nvidia') return 'cuda';

  if (vendor === 'amd') {
    if (arch === 'rdna3' || arch === 'rdna35' || arch === 'rdna4') {
      // llama.cpp: 核显需 VRAM > 16GB 才推荐 ROCm
      if (engineType === 'llamacpp' && isIntegratedGpu(gpu.name)) {
        const vram = gpu.total || 0;
        return vram > IGPU_ROCM_VRAM_THRESHOLD ? 'rocm' : 'vulkan';
      }
      return 'rocm';
    }
    return 'vulkan';
  }

  return 'vulkan';
}

export function recommendRuntimeArch(gpuArch, runtimeList) {
  if (!gpuArch || !Array.isArray(runtimeList) || runtimeList.length === 0) {
    return null;
  }

  // 精确匹配
  const exact = runtimeList.find((rt) => rt.arch === gpuArch);
  if (exact) return exact;

  return null;
}
