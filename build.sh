#!/usr/bin/env bash

# ==============================================================================
# NodePilot 多平台统一构建与发布归档脚本
# 支持交互式菜单与命令行参数一键打包
# 产物规范归档目录: release/
#   - release/macos/    : macOS 原生桌面端 (NodePilot.app)
#   - release/windows/  : Windows 原生桌面端 (NodePilot.exe)
#   - release/linux/    : Linux 原生桌面端或高兼容 CLI
#   - release/cli/      : 三大平台静态交叉编译 CLI 核心引擎
# ==============================================================================

set -e

# 定位项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="${PROJECT_ROOT}/release"
APP_DIR="${PROJECT_ROOT}/app"
ENGINE_DIR="${PROJECT_ROOT}/engine"

# 颜色与样式
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# 打印信息辅助函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 确保目标发布目录存在
ensure_release_dirs() {
    mkdir -p "${RELEASE_DIR}/macos"
    mkdir -p "${RELEASE_DIR}/windows"
    mkdir -p "${RELEASE_DIR}/linux"
    mkdir -p "${RELEASE_DIR}/cli"
}

# 格式化文件大小输出
show_file_info() {
    local target="$1"
    if [ -d "$target" ]; then
        local size
        size=$(du -sh "$target" | awk '{print $1}')
        echo -e "  📦 产物路径: ${CYAN}${target}${NC} (目录体积: ${BOLD}${size}${NC})"
    elif [ -f "$target" ]; then
        local size
        size=$(ls -lh "$target" | awk '{print $5}')
        echo -e "  📦 产物路径: ${CYAN}${target}${NC} (文件大小: ${BOLD}${size}${NC})"
    fi
}

# 检查 Wails CLI
check_wails() {
    if ! command -v wails &> /dev/null; then
        if [ -f "${HOME}/go/bin/wails" ]; then
            export PATH="${HOME}/go/bin:${PATH}"
        else
            log_error "未检测到 Wails CLI，请先执行: go install github.com/wailsapp/wails/v2/cmd/wails@latest"
            exit 1
        fi
    fi
}

# 1. 构建 macOS 桌面端
build_macos() {
    echo ""
    log_info "========== [1/4] 开始构建 macOS 桌面端 =========="
    check_wails
    ensure_release_dirs

    cd "${APP_DIR}"
    log_info "正在使用 Wails 构建 macOS Universal (双架构 x86_64 + arm64) 桌面应用..."
    
    # 尝试构建 Universal，若环境不具备则回退到当前机器原生架构
    if wails build -platform darwin/universal -s; then
        log_success "macOS Universal 架构编译成功！"
    else
        log_warn "Universal 编译失败，回退为针对当前平台原生架构构建..."
        wails build -s
    fi

    # 归档到 release/macos
    rm -rf "${RELEASE_DIR}/macos/NodePilot.app"
    cp -R "${APP_DIR}/build/bin/NodePilot.app" "${RELEASE_DIR}/macos/"
    
    cd "${PROJECT_ROOT}"
    log_success "macOS 桌面端已归档至 release/macos/NodePilot.app"
    show_file_info "${RELEASE_DIR}/macos/NodePilot.app"

    # 打包为标准拖拽安装 DMG 镜像
    if command -v hdiutil &> /dev/null; then
        log_info "正在打包 macOS 原生 DMG 安装镜像 (含 Applications 替身)..."
        local dmg_pack="${APP_DIR}/build/bin/dmg_pack"
        rm -rf "$dmg_pack"
        mkdir -p "$dmg_pack"
        cp -R "${RELEASE_DIR}/macos/NodePilot.app" "$dmg_pack/"
        ln -s /Applications "$dmg_pack/Applications"
        rm -f "${RELEASE_DIR}/macos/NodePilot-macOS-Universal.dmg"
        hdiutil create -volname "NodePilot" -srcfolder "$dmg_pack" -ov -format UDZO "${RELEASE_DIR}/macos/NodePilot-macOS-Universal.dmg"
        rm -rf "$dmg_pack"
        log_success "macOS DMG 安装镜像已生成: release/macos/NodePilot-macOS-Universal.dmg"
        show_file_info "${RELEASE_DIR}/macos/NodePilot-macOS-Universal.dmg"
    fi
}

# 2. 构建 Windows 桌面端
build_windows() {
    echo ""
    log_info "========== [2/4] 开始构建 Windows 桌面端 =========="
    check_wails
    ensure_release_dirs

    cd "${APP_DIR}"
    log_info "正在使用 Wails 交叉编译 Windows 64位 (.exe) 独立桌面端..."
    wails build -platform windows/amd64 -s

    # 归档到 release/windows
    cp "${APP_DIR}/build/bin/NodePilot.exe" "${RELEASE_DIR}/windows/NodePilot.exe"
    
    cd "${PROJECT_ROOT}"
    log_success "Windows 桌面端已归档至 release/windows/NodePilot.exe"
    show_file_info "${RELEASE_DIR}/windows/NodePilot.exe"
}

# 3. 构建 Linux 平台产物
build_linux() {
    echo ""
    log_info "========== [3/4] 开始构建 Linux 平台产物 =========="
    ensure_release_dirs

    local os_type
    os_type="$(uname -s)"

    if [ "$os_type" = "Linux" ]; then
        check_wails
        cd "${APP_DIR}"
        log_info "宿主为原生 Linux 环境，正在构建 Linux 桌面应用..."
        wails build -platform linux/amd64 -tags webkit2_41 -s || wails build -platform linux/amd64 -s
        cp "${APP_DIR}/build/bin/NodePilot" "${RELEASE_DIR}/linux/NodePilot"
        chmod +x "${RELEASE_DIR}/linux/NodePilot"
        cd "${PROJECT_ROOT}"
        log_success "Linux 桌面应用已归档至 release/linux/NodePilot"
        show_file_info "${RELEASE_DIR}/linux/NodePilot"
    else
        log_warn "当前宿主机为 ${os_type}。因 Wails Linux GUI 依赖系统 GTK3/WebKitGTK 动态库，跨系统构建桌面 GUI 需在 Linux 环境或 Docker 容器中执行。"
        log_info "正在交叉编译 Linux 64位无依赖静态 CLI 引擎至 release/linux/ ..."
        cd "${ENGINE_DIR}"
        CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o "${RELEASE_DIR}/linux/nodepilot-linux-amd64" main.go
        chmod +x "${RELEASE_DIR}/linux/nodepilot-linux-amd64"
        cd "${PROJECT_ROOT}"
        log_success "Linux 静态可执行程序已归档至 release/linux/nodepilot-linux-amd64"
        show_file_info "${RELEASE_DIR}/linux/nodepilot-linux-amd64"
    fi
}

# 4. 构建跨平台 CLI 核心引擎
build_cli() {
    echo ""
    log_info "========== [4/4] 开始构建跨平台 CLI 核心引擎 =========="
    ensure_release_dirs

    cd "${ENGINE_DIR}"

    log_info "正在交叉编译 macOS ARM64 CLI..."
    CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o "${RELEASE_DIR}/cli/nodepilot-cli-darwin-arm64" main.go

    log_info "正在交叉编译 macOS x86_64 CLI..."
    CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o "${RELEASE_DIR}/cli/nodepilot-cli-darwin-amd64" main.go

    log_info "正在交叉编译 Windows x86_64 CLI..."
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o "${RELEASE_DIR}/cli/nodepilot-cli-windows-amd64.exe" main.go

    log_info "正在交叉编译 Linux x86_64 CLI..."
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o "${RELEASE_DIR}/cli/nodepilot-cli-linux-amd64" main.go

    chmod +x "${RELEASE_DIR}/cli/nodepilot-cli-darwin-arm64" "${RELEASE_DIR}/cli/nodepilot-cli-darwin-amd64" "${RELEASE_DIR}/cli/nodepilot-cli-linux-amd64" 2>/dev/null || true

    cd "${PROJECT_ROOT}"
    log_success "三大平台 CLI 引擎编译完成，已归档至 release/cli/:"
    show_file_info "${RELEASE_DIR}/cli/nodepilot-cli-darwin-arm64"
    show_file_info "${RELEASE_DIR}/cli/nodepilot-cli-darwin-amd64"
    show_file_info "${RELEASE_DIR}/cli/nodepilot-cli-windows-amd64.exe"
    show_file_info "${RELEASE_DIR}/cli/nodepilot-cli-linux-amd64"
}

# 汇总打印产物清单 (仅打印本次构建目标对应的产物)
print_summary() {
    local target="$1"
    echo ""
    echo -e "${GREEN}${BOLD}==================================================================${NC}"
    echo -e "${GREEN}${BOLD}                   🎉 本次构建完成清单                          ${NC}"
    echo -e "${GREEN}${BOLD}==================================================================${NC}"
    
    case "$target" in
        all|0)
            [ -d "${RELEASE_DIR}/macos/NodePilot.app" ] && show_file_info "${RELEASE_DIR}/macos/NodePilot.app"
            [ -f "${RELEASE_DIR}/macos/NodePilot-macOS-Universal.dmg" ] && show_file_info "${RELEASE_DIR}/macos/NodePilot-macOS-Universal.dmg"
            [ -f "${RELEASE_DIR}/windows/NodePilot.exe" ] && show_file_info "${RELEASE_DIR}/windows/NodePilot.exe"
            [ -f "${RELEASE_DIR}/linux/NodePilot" ] && show_file_info "${RELEASE_DIR}/linux/NodePilot"
            ;;
        mac|1)
            [ -d "${RELEASE_DIR}/macos/NodePilot.app" ] && show_file_info "${RELEASE_DIR}/macos/NodePilot.app"
            [ -f "${RELEASE_DIR}/macos/NodePilot-macOS-Universal.dmg" ] && show_file_info "${RELEASE_DIR}/macos/NodePilot-macOS-Universal.dmg"
            ;;
        win|2)
            [ -f "${RELEASE_DIR}/windows/NodePilot.exe" ] && show_file_info "${RELEASE_DIR}/windows/NodePilot.exe"
            ;;
        linux|3)
            [ -f "${RELEASE_DIR}/linux/NodePilot" ] && show_file_info "${RELEASE_DIR}/linux/NodePilot"
            [ -f "${RELEASE_DIR}/linux/nodepilot-linux-amd64" ] && show_file_info "${RELEASE_DIR}/linux/nodepilot-linux-amd64"
            ;;
        cli|4)
            [ -f "${RELEASE_DIR}/cli/nodepilot-cli-darwin-arm64" ] && show_file_info "${RELEASE_DIR}/cli/nodepilot-cli-darwin-arm64"
            [ -f "${RELEASE_DIR}/cli/nodepilot-cli-darwin-amd64" ] && show_file_info "${RELEASE_DIR}/cli/nodepilot-cli-darwin-amd64"
            [ -f "${RELEASE_DIR}/cli/nodepilot-cli-windows-amd64.exe" ] && show_file_info "${RELEASE_DIR}/cli/nodepilot-cli-windows-amd64.exe"
            [ -f "${RELEASE_DIR}/cli/nodepilot-cli-linux-amd64" ] && show_file_info "${RELEASE_DIR}/cli/nodepilot-cli-linux-amd64"
            ;;
    esac
    echo -e "${GREEN}${BOLD}==================================================================${NC}"
    echo ""
}

# 全部生成 (聚焦全套桌面端)
build_all() {
    build_macos
    build_windows
    build_linux
    print_summary all
}

# 调度分发
dispatch_choice() {
    case "$1" in
        0|all|ALL)
            build_all
            ;;
        1|mac|macos|darwin)
            build_macos
            print_summary mac
            ;;
        2|win|windows)
            build_windows
            print_summary win
            ;;
        3|linux)
            build_linux
            print_summary linux
            ;;
        4|cli|engine)
            build_cli
            print_summary cli
            ;;
        q|Q|exit)
            echo "已取消构建。"
            exit 0
            ;;
        *)
            log_error "未知选项: $1"
            echo "可用参数: 0 (全部), 1 (macOS), 2 (Windows), 3 (Linux), 4 (CLI)"
            exit 1
            ;;
    esac
}

# 入口判断：若传入了参数则直接分发；若无参数则打开交互式菜单
if [ -n "$1" ]; then
    dispatch_choice "$1"
else
    clear 2>/dev/null || true
    echo -e "${CYAN}${BOLD}==================================================================${NC}"
    echo -e "${CYAN}${BOLD}                 NodePilot 跨平台统一构建打包工具                 ${NC}"
    echo -e "${CYAN}${BOLD}==================================================================${NC}"
    echo -e " ${BOLD}[0]${NC} 全部桌面端生成 (macOS DMG/App + Windows EXE + Linux 桌面端)"
    echo -e " ${BOLD}[1]${NC} 生成 macOS 桌面端 (NodePilot.app 与 DMG 拖拽安装镜像)"
    echo -e " ${BOLD}[2]${NC} 生成 Windows 桌面端 (release/windows/NodePilot.exe)"
    echo -e " ${BOLD}[3]${NC} 生成 Linux 平台产物 (release/linux/)"
    echo -e " ${BOLD}[4]${NC} (开发者选配) 仅生成底层 CLI 核心引擎 (release/cli/)"
    echo -e " ${BOLD}[q]${NC} 退出"
    echo -e "${CYAN}${BOLD}==================================================================${NC}"
    read -rp "请输入目标编号 [0-4 / q] (默认 0): " choice
    choice="${choice:-0}"
    dispatch_choice "$choice"
fi
