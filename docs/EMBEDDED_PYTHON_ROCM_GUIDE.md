# Embedded Python + ROCm + PyTorch 整合包制作教程

基于 `C:\AI_Work\python_embeded` 整合包的分析，记录完整的嵌入式 Python ROCm 环境搭建方法。

## 目录

- [原理概述](#原理概述)
- [环境信息](#环境信息)
- [第一步：准备 Embedded Python](#第一步准备-embedded-python)
- [第二步：解除隔离机制](#第二步解除隔离机制)
- [第三步：安装 pip](#第三步安装-pip)
- [第四步：安装 ROCm SDK](#第四步安装-rocm-sdk)
- [第五步：安装 PyTorch ROCm](#第五步安装-pytorch-rocm)
- [第六步：安装其他依赖](#第六步安装其他依赖)
- [第七步：集成 ComfyUI（可选）](#第七步集成-comfyui可选)
- [第八步：打包分发](#第八步打包分发)
- [附录：各组件体积参考](#附录各组件体积参考)
- [附录：ROCm SDK 包结构详解](#附录rocm-sdk-包结构详解)
- [附录：常见问题](#附录常见问题)

---

## 原理概述

### 什么是 Embedded Python

Python 官方提供的 **Windows embeddable package** 是一个精简的、可移植的 Python 运行时。与标准安装不同：

| | 标准 Python | Embedded Python |
|---|---|---|
| 安装方式 | 安装器 (msi/exe) | 解压 zip 即用 |
| 注册表 | 写入注册表 | 不写注册表 |
| 体积 | ~100 MB | ~40 MB (压缩包) |
| site-packages | 默认加载 | 默认**隔离**（不加载） |
| 可移植 | 否（路径硬编码） | 是（放到哪都能跑） |

### 隔离机制：`python3xx._pth`

Embedded Python 根目录下有一个 `python312._pth` 文件，内容为：

```ini
python312.zip
.

# Uncomment to run site.main() automatically
#import site
```

这个文件的存在**激活了隔离模式**——Python 只从 `python312.zip` 和当前目录查找模块，**不加载 `Lib/site-packages`**。

**解除隔离的方法**：将 `python312._pth` 重命名为 `python312._pth.bak`（或直接删除），Python 即恢复标准行为，自动发现 `Lib/site-packages`。

```
python312._pth     →  隔离模式（embedded 默认）
python312._pth.bak →  标准模式（正常加载 site-packages）
（文件不存在）      →  标准模式
```

### 整体流程

```
1. 下载 Python embedded zip
       ↓
2. 解压到目标目录
       ↓
3. 重命名 python312._pth → .bak （解除隔离）
       ↓
4. 运行 get-pip.py 安装 pip
       ↓
5. pip install ROCm SDK 包
       ↓
6. pip install PyTorch ROCm 版
       ↓
7. pip install 其他依赖（ComfyUI 等）
       ↓
8. 7z 打包
```

---

## 环境信息

本教程基于以下版本（参考 `python_embeded` 整合包）：

| 组件 | 版本 | 来源 |
|------|------|------|
| Python | 3.12.10 (embedded) | python.org |
| ROCm SDK | 7.13.0a20260423 | AMD 官方 wheel |
| PyTorch | 2.9.1+rocm7.13.0a20260423 | AMD 官方 wheel |
| torchvision | 0.24.0+rocm7.13.0a20260423 | AMD 官方 wheel |
| torchaudio | 2.9.0+rocm7.13.0a20260423 | AMD 官方 wheel |
| GPU 架构 | gfx1151 (Radeon 8060S) | 按需选择 |

> **注意**：ROCm SDK 和 PyTorch 版本必须匹配。例如 `rocm-sdk-*` 的版本号要和 `torch` 的 `+rocmX.X.X` 后缀对应。

---

## 第一步：准备 Embedded Python

### 1.1 下载

从 Python 官网下载 Windows embeddable package：

```
https://www.python.org/downloads/windows/
```

选择 **Windows embeddable package (64-bit)**，例如 `python-3.12.10-embed-amd64.zip`。

> 不要下 "Windows installer"，下 "Windows embeddable package"。

### 1.2 解压

```powershell
# 假设目标目录为 D:\comfyui-rocm
New-Item -ItemType Directory -Force D:\comfyui-rocm
Expand-Archive python-3.12.10-embed-amd64.zip -DestinationPath D:\comfyui-rocm
```

解压后的目录结构：

```
D:\comfyui-rocm\
├── python.exe
├── pythonw.exe
├── python312.dll
├── python3.dll
├── python312._pth          ← 隔离配置文件
├── python312.zip            ← 标准库压缩包
├── sqlite3.dll
├── vcruntime140.dll
├── vcruntime140_1.dll
├── *.pyd                    ← 各种 C 扩展
├── Lib\                     ← 空目录，用于放置第三方包
└── ...
```

---

## 第二步：解除隔离机制

```powershell
cd D:\comfyui-rocm

# 重命名 _pth 文件，解除隔离
Rename-Item python312._pth python312._pth.bak
```

验证：`.bak` 文件内容应包含 `import site`（已取消注释）：

```ini
python312.zip
.

# Uncomment to run site.main() automatically
import site
```

> 如果文件不存在（被删除），Python 也会恢复正常模式，但保留 `.bak` 方便以后恢复隔离。

---

## 第三步：安装 pip

### 3.1 下载 get-pip.py

```powershell
# 从官方下载
Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile "get-pip.py"
```

### 3.2 安装 pip

```powershell
.\python.exe get-pip.py
```

### 3.3 验证

```powershell
.\python.exe -m pip --version
# pip 26.x.x from D:\comfyui-rocm\Lib\site-packages\pip (python 3.12)
```

此时 `Lib/site-packages/` 下会出现 `pip`、`setuptools` 等目录。

---

## 第四步：安装 ROCm SDK

ROCm SDK 在 Windows 上以 pip 包形式分发，分为 4 个包：

| 包名 | 作用 | 必须？ |
|------|------|--------|
| `rocm-sdk-core` | HIP 运行时 DLLs + LLVM 编译器库（bitcode） | ✅ 必须 |
| `rocm-sdk-libraries-gfxXXXX` | GPU 架构专用 AI 库（MIOpen, rocBLAS 等） | ✅ 必须 |
| `rocm-sdk-devel` | ROCm 编译工具链（6GB tar） | ❌ 运行无需 |
| `rocm` | 空壳元包，聚合依赖 | 可选 |

### 4.1 确定 GPU 架构代号

不同 GPU 对应不同的 gfx 代号，需要下载对应的 `rocm-sdk-libraries`：

| GPU 系列 | gfx 代号 | 示例型号 |
|----------|----------|---------|
| RDNA 3.5 (Strix Halo) | `gfx1151` | Radeon 8060S, AI Max 395 |
| RDNA 3.5 (Strix Point) | `gfx1150` | Radeon 890M, AI 9 HX 370 |
| RDNA 3 (Navi 31/32) | `gfx1100` | RX 7900 XTX/XT |
| RDNA 3 (Navi 33) | `gfx1102` | RX 7600 |
| RDNA 2 | `gfx1030` | RX 6900 XT |

```powershell
# 查看 GPU 架构（在已有 ROCm 环境下）
.\python.exe -c "import torch; print(torch.cuda.get_device_properties(0).gcnArchName)"
```

### 4.2 从 AMD 官方源安装

AMD 官方 pip 仓库：`https://repo.radeon.com/rocm/windows/rocm-rel-{version}/`

```powershell
# 方式 A：从 AMD 仓库在线安装（推荐）

# 设置 ROCm 版本
$ROCM_VER = "7.2.1"
$GFX = "gfx1151"

# 安装 ROCm SDK 核心
.\python.exe -m pip install rocm-sdk-core `
    --extra-index-url "https://repo.radeon.com/rocm/windows/rocm-rel-$ROCM_VER/"

# 安装 GPU 架构专用库
.\python.exe -m pip install rocm-sdk-libraries-$GFX `
    --extra-index-url "https://repo.radeon.com/rocm/windows/rocm-rel-$ROCM_VER/"

# （可选）安装元包
.\python.exe -m pip install rocm `
    --extra-index-url "https://repo.radeon.com/rocm/windows/rocm-rel-$ROCM_VER/"
```

### 4.3 从本地 wheel 安装（离线/预下载）

```powershell
# 方式 B：先下载 wheel 到本地，再安装

# 从 AMD 仓库下载 wheel 文件（浏览器或 curl）
# 例如：
#   rocm_sdk_core-7.2.1-py3-none-win_amd64.whl
#   rocm_sdk_libraries_gfx1151-7.2.1-py3-none-win_amd64.whl

# 本地安装
.\python.exe -m pip install rocm_sdk_core-7.2.1-py3-none-win_amd64.whl
.\python.exe -m pip install rocm_sdk_libraries_gfx1151-7.2.1-py3-none-win_amd64.whl
```

### 4.4 验证 ROCm 安装

```powershell
# 检查 ROCm 版本
.\python.exe -c "import _rocm_sdk_core; print(_rocm_sdk_core.__file__)"

# 检查 HIP DLL 是否存在
Test-Path "Lib\site-packages\_rocm_sdk_core\bin\amdhip64_7.dll"
# 应返回 True

# 检查 GPU 库
Test-Path "Lib\site-packages\_rocm_sdk_libraries_gfx1151\bin\MIOpen.dll"
# 应返回 True
```

---

## 第五步：安装 PyTorch ROCm

### 5.1 从 AMD 仓库安装

```powershell
# PyTorch ROCm 版（和 ROCm SDK 使用同一个 extra-index-url）
.\python.exe -m pip install torch torchvision torchaudio `
    --extra-index-url "https://repo.radeon.com/rocm/windows/rocm-rel-$ROCM_VER/"
```

### 5.2 从本地 wheel 安装

```powershell
# 预下载的 wheel 文件：
#   torch-2.9.1+rocm7.13.0a20260423-cp312-cp312-win_amd64.whl
#   torchvision-0.24.0+rocm7.13.0a20260423-cp312-cp312-win_amd64.whl
#   torchaudio-2.9.0+rocm7.13.0a20260423-cp312-cp312-win_amd64.whl

.\python.exe -m pip install torch-2.9.1+rocm7.13.0a20260423-cp312-cp312-win_amd64.whl
.\python.exe -m pip install torchvision-0.24.0+rocm7.13.0a20260423-cp312-cp312-win_amd64.whl
.\python.exe -m pip install torchaudio-2.9.0+rocm7.13.0a20260423-cp312-cp312-win_amd64.whl
```

### 5.3 验证 PyTorch

```powershell
.\python.exe -c @"
import torch
print('PyTorch:', torch.__version__)
print('ROCm:', torch.version.hip)
print('GPU available:', torch.cuda.is_available())
print('GPU count:', torch.cuda.device_count())
if torch.cuda.is_available():
    print('GPU:', torch.cuda.get_device_name(0))
    print('VRAM total:', torch.cuda.get_device_properties(0).total_mem // 1024**3, 'GB')
"@
```

预期输出：

```
PyTorch: 2.9.1+rocm7.13.0a20260423
ROCm: 7.13.26162
GPU available: True
GPU count: 1
GPU: AMD Radeon(TM) 8060S Graphics
VRAM total: 49 GB
```

### 5.4 验证 torch 的 ROCm HIP DLLs

PyTorch 在 `torch/lib/` 下有自己的 HIP 后端 DLLs：

| DLL | 大小 | 作用 |
|-----|------|------|
| `torch_hip.dll` | ~112 MB | PyTorch HIP GPU 后端 |
| `torch_cpu.dll` | ~214 MB | PyTorch CPU 后端 |
| `torch_python.dll` | ~23 MB | Python-C++ 绑定 |
| `c10_hip.dll` | ~2 MB | C10 调度层 HIP 支持 |
| `aotriton_v2.dll` | ~2 MB | AOTriton GPU kernel 编译器 |

---

## 第六步：安装其他依赖

### 6.1 ComfyUI 核心依赖

```powershell
.\python.exe -m pip install -r requirements.txt
```

ComfyUI 的 `requirements.txt` 主要包含：

```
aiohttp
comfyui-frontend-package
comfyui-workflow-templates
einops
huggingface_hub
kornia
numpy
pillow
psutil
pydantic
pyyaml
safetensors
scipy
spandrel
tokenizers
torchsde
tqdm
transformers
```

### 6.2 常用附加包（可选）

```powershell
# AI 推理加速
.\python.exe -m pip install bitsandbytes triton-windows

# 图像处理
.\python.exe -m pip install opencv-python imageio imageio-ffmpeg

# 模型下载
.\python.exe -m pip install modelscope huggingface_hub

# llama.cpp Python 绑定
.\python.exe -m pip install llama-cpp-python

# 其他 AI 库
.\python.exe -m pip install onnxruntime diffusers accelerate peft
```

---

## 第七步：集成 ComfyUI（可选）

如果要制作 ComfyUI 专用整合包：

### 7.1 下载 ComfyUI 源码

```powershell
# 从 GitHub 下载 ComfyUI 源码
git clone https://github.com/comfyanonymous/ComfyUI.git temp-comfyui

# 将 ComfyUI 文件复制到环境根目录
Copy-Item -Recurse temp-comfyui\* D:\comfyui-rocm\
Remove-Item -Recurse temp-comfyui
```

### 7.2 最终目录结构

```
comfyui-rocm/
├── python.exe                   ← Embedded Python
├── pythonw.exe
├── python312.dll
├── python312._pth.bak           ← 隔离已解除
├── main.py                      ← ComfyUI 入口
├── nodes.py
├── comfy/
├── app/
├── custom_nodes/
├── requirements.txt
├── run_amd_gpu.bat              ← 启动脚本
├── Lib/
│   └── site-packages/
│       ├── torch/               ← PyTorch ROCm
│       ├── torchvision/
│       ├── _rocm_sdk_core/      ← HIP 运行时
│       ├── _rocm_sdk_libraries_gfx1151/ ← GPU 专用库
│       ├── transformers/
│       ├── ...                  ← 其他 pip 包
│       └── pip/
├── Scripts/                     ← pip 安装后自动生成
└── ...
```

### 7.3 启动脚本

`run_amd_gpu.bat`：

```batch
@echo off
set PYTHONIOENCODING=utf-8
set PYTHONUNBUFFERED=1
.\python.exe main.py --listen 0.0.0.0 --port 8188
```

---

## 第八步：打包分发

### 8.1 清理不需要的文件

```powershell
# 删除 pip 缓存
Remove-Item -Recurse -Force Lib\site-packages\pip\_vendor\certifi\tests -ErrorAction SilentlyContinue

# 删除 __pycache__
Get-ChildItem -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force

# 删除 .dist-info 中的测试文件（可选）
# 注意：.dist-info 目录本身不能删，否则 pip 无法管理包

# 删除 rocm_sdk_devel（6GB 的编译器，运行时不需要）
.\python.exe -m pip uninstall -y rocm-sdk-devel
```

### 8.2 使用 7z 压缩

**强烈推荐 7z**，因为二进制 DLL/PYD 文件用 LZMA2 压缩率远高于 zip/tar.gz：

```powershell
# 安装 7-Zip 后
7z a -mx=9 -mmt=on comfyui-rocm-gfx1151.7z D:\comfyui-rocm\
```

| 压缩格式 | 压缩比 | 3.5 GB 内容压缩后 |
|----------|--------|-------------------|
| zip (Deflate) | 低 | ~2.5 GB |
| tar.gz (gzip) | 中 | ~2.0 GB |
| **7z (LZMA2)** | **高** | **~1.3 GB** |

### 8.3 估算最终体积

| 组成部分 | 解压后 | 7z 压缩后 |
|----------|--------|----------|
| Embedded Python 基座 | ~100 MB | ~30 MB |
| ROCm SDK (core + libraries) | ~1.2 GB | ~400 MB |
| PyTorch + torchvision + torchaudio | ~1.0 GB | ~350 MB |
| ComfyUI 代码 + 依赖 | ~800 MB | ~300 MB |
| 其他 pip 包 | ~500 MB | ~200 MB |
| **合计** | **~3.6 GB** | **~1.3 GB** |

> 对照：官方 ComfyUI CUDA portable 版约 ~1.3 GB (7z 下载)，解压 ~3 GB。

---

## 附录：各组件体积参考

以 `python_embeded` 整合包（13.35 GB）为例：

```
rocm_sdk_devel/_devel.tar              5.87 GB   ← 可删除（开发工具链）
_rocm_sdk_core/lib/                    1.82 GB   ← LLVM bitcode（可精简架构）
_rocm_sdk_libraries_gfx1151/bin/       1.00 GB   ← MIOpen/rocBLAS（必须保留）
_rocm_sdk_core/bin/                    0.21 GB   ← HIP 运行时 DLLs（必须保留）
torch + torchvision + torchaudio       0.97 GB   ← PyTorch（必须保留）
其他 500+ pip 包                       3.48 GB   ← ComfyUI/OpenCV/AI 框架

去掉 rocm_sdk_devel 后：               7.48 GB
再去掉 _rocm_sdk_core/lib/ (LLVM):     5.66 GB
仅保留核心运行时：                      ~3-4 GB
```

---

## 附录：ROCm SDK 包结构详解

### rocm-sdk-core (`_rocm_sdk_core/`)

```
_rocm_sdk_core/
├── .info/version                          ← 版本号文件
├── bin/
│   ├── amdhip64_7.dll          19 MB      ← HIP 运行时（核心）
│   ├── amd_comgr0713.dll      111 MB      ← AMD Code Object Manager
│   ├── amdocl64.dll            15 MB      ← OpenCL 运行时
│   ├── rocm-openblas64.dll     11 MB      ← OpenBLAS
│   ├── rocm-openblas.dll       11 MB      ← OpenBLAS (32位接口)
│   ├── hiprtc07013.dll          2 MB      ← HIP 运行时编译
│   ├── hiprtc-builtins07013.dll 1 MB      ← HIP RTC 内置函数
│   ├── cltrace.dll              1 MB      ← OpenCL 追踪
│   └── rocm_kpack.dll         0.2 MB      ← 打包工具
├── include/                     4 MB      ← C/C++ 头文件（开发用）
├── lib/                      1823 MB      ← LLVM 编译器 bitcode/tools（可精简）
│   └── llvm/
│       ├── amdgcn/bitcode/               ← GPU 架构 bitcode (71 个文件)
│       ├── bin/                          ← LLVM 工具链
│       └── lib/                          ← LLVM 库
├── libexec/                     1 MB      ← 辅助执行文件
└── share/                      <1 MB      ← 共享数据
```

### rocm-sdk-libraries-gfx1151 (`_rocm_sdk_libraries_gfx1151/`)

```
_rocm_sdk_libraries_gfx1151/
└── bin/
    ├── MIOpen.dll                      471 MB   ← AMD 深度学习推理库（最大）
    ├── MIOpenCKGroupedConv_gfx1151.dll  240 MB   ← 分组卷积 kernel
    ├── rocsparse.dll                     79 MB   ← 稀疏矩阵运算
    ├── rocrand.dll                       67 MB   ← 随机数生成
    ├── rocsolver.dll                     44 MB   ← 线性代数求解器
    ├── rocfft.dll                        25 MB   ← 快速傅里叶变换
    ├── rocblas.dll                       25 MB   ← 基础线性代数
    ├── libhipblaslt.dll                   6 MB   ← HIP BLAS Lite
    ├── hipdnn_backend.dll                 2 MB   ← 深度神经网络后端
    ├── hipblas.dll                      0.8 MB   ← HIP BLAS 接口
    ├── hipfftw.dll                      0.3 MB   ← HIP FFTW 接口
    ├── hipsparse.dll                    0.2 MB   ← HIP 稀疏矩阵接口
    ├── hipsolver.dll                    0.3 MB   ← HIP 求解器接口
    ├── hipfft.dll                       0.1 MB   ← HIP FFT 接口
    └── hiprand.dll                      0.02 MB  ← HIP 随机数接口
```

---

## 附录：常见问题

### Q: 为什么不直接用 conda？

Conda 环境自带大量元数据和冗余组件（conda-meta, Library/, etc/, include/, share/）。对于整合包分发，embedded Python 更干净：

| | Conda 环境 | Embedded Python |
|---|---|---|
| 基础体积 | ~500 MB (仅 Python) | ~40 MB (zip) |
| 冗余文件 | conda-meta, Library, etc. | 无 |
| 可移植性 | 需要 conda-unpack 修复路径 | 天然可移植 |
| pip 兼容性 | 可能冲突 | 标准 pip |

### Q: 不同 GPU 架构需要不同的包吗？

是的。`rocm-sdk-libraries-gfxXXXX` 是 GPU 架构专用的，包含为该架构编译的 MIOpen、rocBLAS 等 kernel。如果支持多架构，需要安装多个 `rocm-sdk-libraries` 包。

### Q: `rocm-sdk-devel` 可以删吗？

可以。它是 6 GB 的编译器工具链（HIP 编译器、设备端库源码），仅用于开发和编译 GPU kernel。运行时完全不需要。

### Q: `_rocm_sdk_core/lib/` 可以删吗？

部分可以。`lib/llvm/` 下的 bitcode 文件（`.bc`）用于 JIT 编译 GPU kernel。如果你运行的模型不需要 JIT 编译（大多数推理场景），可以安全删除或精简为目标架构的 bitcode。

### Q: 如何更新 PyTorch？

```powershell
.\python.exe -m pip install --upgrade torch torchvision torchaudio `
    --extra-index-url "https://repo.radeon.com/rocm/windows/rocm-rel-{new_version}/"
```

注意：PyTorch 和 ROCm SDK 版本必须匹配。

### Q: NVIDIA 版怎么做？

NVIDIA 版更简单——CUDA 运行时随 PyTorch wheel 一起发布，不需要额外的 SDK 包：

```powershell
# NVIDIA 版只需一步
.\python.exe -m pip install torch torchvision torchaudio `
    --index-url https://download.pytorch.org/whl/cu128
```

CUDA DLLs（cublas, cudnn 等）已在 torch wheel 内，无需再装 `rocm-sdk-*`。
