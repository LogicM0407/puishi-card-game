# 谱师卡牌 - 跨网络联机游戏

一款支持跨设备、跨网络联机的卡牌游戏。

## 功能特性

- 🎮 **跨设备联机**：支持手机、平板、电脑多端联机
- 🌍 **跨网络连接**：支持不同 WiFi 网络下的设备连接
- 🔒 **P2P 直连**：使用 WebRTC 点对点技术，数据直接传输
- ⚡ **无需服务器**：使用 PeerJS 公共信令服务器，零成本部署

## 联机模式

1. **同 WiFi 局域网**：需要启动本地服务器
2. **跨网络 P2P**：基于 WebRTC，支持不同网络下的设备连接（推荐）

## GitHub Pages 部署说明

本页面已部署到 GitHub Pages，访问地址：

```
https://<你的用户名>.github.io/<仓库名>/
```

> ⚠️ 注意：GitHub Pages 只支持静态文件托管，局域网 WebSocket 模式不可用。
> 请使用「跨网络 P2P」模式进行联机。

## 本地开发

```bash
# 安装依赖
npm install

# 启动服务器
node server.js

# 访问 http://localhost:8093/game.html
```

## 技术栈

- 纯前端 HTML + JavaScript
- WebRTC / PeerJS (P2P 联机)
- Node.js / WebSocket (局域网模式)
