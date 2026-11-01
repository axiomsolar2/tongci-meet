# 同词相遇

一个支持好友房间实时对战的双人文字小游戏。无主题、无提示，双方每轮自由输入一个词；答案一致即相遇。

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm start
```

浏览器打开：

```text
http://localhost:3000
```

同一局域网内的朋友可以访问运行服务器的电脑 IP 和端口进行联机。跨网络好友需要部署到公网服务器。

## 游戏规则

- 创建房间后获得 6 位房间号，分享给好友。
- 房间最多两名玩家。
- 每轮双方独立提交一个词，提交前看不到对方答案。
- 双方都提交后公布答案。
- 忽略大小写、全半角差异、空格和常见标点后进行比较；答案一致即相遇。
- 未相遇则自动进入下一轮，直到成功。
- 相遇次数、游戏场次和场均轮数会计入排行榜。

## 部署到 Render

1. 将整个项目上传到自己的 GitHub 仓库。
2. 登录 Render，选择 **New + → Web Service**，连接该仓库。
3. 配置：
   - Runtime：Node
   - Build Command：`npm install`
   - Start Command：`npm start`
4. 创建服务并等待部署完成。
5. 如需让排行榜在服务重启或重新部署后保留，在 Render 为服务挂载 Persistent Disk：
   - Mount Path：`/var/data`
   - Environment Variable：`DATA_DIR=/var/data`
6. 部署成功后，Render 会提供一个 `https://...onrender.com` 网站地址。把地址分享给好友即可。

> 注意：没有持久化磁盘时，排行榜文件可能在重新部署或实例重启后丢失。Render 的磁盘和实例收费规则以平台当前方案为准。免费实例可能休眠，首次访问会有启动等待。

## 目录结构

```text
tongci-meet/
├── server.js
├── package.json
├── README.md
├── data/                 # 自动创建；排行榜数据
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

## 当前版本说明

- 实时通信使用 Socket.IO。
- 房间和当前对局状态保存在服务端内存中；服务进程重启后，进行中的房间会结束。
- 排行榜保存在 `DATA_DIR/leaderboard.json`。
- 排行榜以浏览器生成的玩家 ID 识别玩家；清除浏览器站点数据或换设备会生成新身份。
- 本项目未接入账号系统、反作弊系统或跨设备身份同步。
