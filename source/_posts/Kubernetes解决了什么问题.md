---
title: Kubernetes 解决了什么问题：从手工运维到容器编排
date: 2026-08-29 19:58:27
updated: 2026-09-13 10:00:00
permalink: k8s-01-why-kubernetes/
categories:
  - 云原生
tags:
  - Kubernetes
  - K8s
  - 容器编排
  - 学习记录
description: 通过一个可亲手操作的 Docker 多实例实验，理解手工运维的痛点，以及 Kubernetes 的声明式管理、控制循环、自愈、调度和服务发现究竟解决了什么问题。
keywords:
  - Kubernetes
  - K8s
  - Docker
  - 容器编排
  - 声明式管理
  - 控制循环
toc: true
toc_number: false
---

> 本文是《K8s学习记录》系列第 01 篇。[返回系列目录](/k8s-learning-notes/)

## 本章要解决的问题

学习 Kubernetes 时，一个常见困惑是：

> Docker 已经可以运行容器了，为什么还需要 Kubernetes？

如果只运行一个博客、一个数据库或者一个本地开发环境，直接使用 Docker 完全没有问题。真正的困难通常出现在应用开始拥有多个实例、多个版本、多个节点，并且需要持续更新和故障恢复之后。

这一章不急着安装 Kubernetes，也不要求记住大量组件名称。我们先亲手管理几个 Docker 容器，观察手工运维会遇到什么问题，再看看 Kubernetes 如何把这些重复工作变成一套持续运行的自动化机制。

完成本章后，你应该能够：

- 说清楚容器运行时与容器编排平台的职责差异；
- 亲手启动、检查、删除、恢复和扩容多个 Docker 容器；
- 理解“期望状态”“实际状态”“声明式管理”和“控制循环”；
- 知道 Pod、Deployment、Service 各自负责什么；
- 描述控制平面和工作节点之间的大致协作过程；
- 判断一个项目是否真的需要 Kubernetes；
- 知道 Kubernetes 能解决什么，以及它不能替你解决什么。

<!-- 系列统一使用手写章节编号；空 div 保留原有标题锚点，兼容已分享的链接。 -->
<div id="开始前的准备"></div>

## 1. 开始前的准备

本章只需要一套可以正常运行的 Docker 环境：

- macOS、Windows：推荐使用 Docker Desktop；
- Linux：使用 Docker Engine；
- 不需要提前安装 kind；
- 不需要提前安装 kubectl；
- 实验会占用本机的 `8081`～`8084` 端口。

先确认 Docker 客户端和服务端都可以正常工作：

```bash
docker version
```

正常情况下，输出中应该同时出现 `Client` 和 `Server`。如果只有 Client，或者出现无法连接 Docker daemon 的错误，说明 Docker 服务还没有启动。

再运行一个最小测试：

```bash
docker run --rm hello-world
```

看到 `Hello from Docker!` 后，说明本章的实验环境已经准备好。

> Windows PowerShell 用户如果发现 `curl` 的行为与本文不同，可以把命令中的 `curl` 换成 `curl.exe`，或者直接用浏览器访问对应地址。

<div id="从一个容器开始"></div>

## 2. 从一个容器开始

先启动一个 Nginx 容器：

```bash
docker run -d \
  --name k8s-study-web-1 \
  -p 127.0.0.1:8081:80 \
  nginx:alpine
```

如果你使用的终端不支持反斜杠换行，也可以写成一行：

```bash
docker run -d --name k8s-study-web-1 -p 127.0.0.1:8081:80 nginx:alpine
```

逐项理解这个命令：

| 参数 | 含义 |
| --- | --- |
| `docker run` | 基于镜像创建并启动一个容器 |
| `-d` | 让容器在后台运行 |
| `--name k8s-study-web-1` | 为容器指定一个便于识别的名字 |
| `-p 127.0.0.1:8081:80` | 将本机 `8081` 端口映射到容器的 `80` 端口，并只允许从本机访问 |
| `nginx:alpine` | 使用 Nginx 的 Alpine 镜像 |

检查容器状态：

```bash
docker ps --filter name=k8s-study-web-1
```

重点观察 `STATUS` 和 `PORTS` 两列：

- `STATUS` 类似 `Up 10 seconds`，表示容器正在运行；
- `PORTS` 应该包含 `127.0.0.1:8081->80/tcp`。

访问这个容器：

```bash
curl -I http://127.0.0.1:8081
```

预期可以看到类似下面的响应：

```text
HTTP/1.1 200 OK
Server: nginx
```

也可以直接在浏览器中打开：

```text
http://127.0.0.1:8081
```

到这里，我们只运行了一个应用实例。它的容器名、端口和运行位置都由我们手工决定，看起来并不复杂。

<div id="手动扩容到三个实例"></div>

## 3. 手动扩容到三个实例

假设访问量增加，我们希望同时运行三个 Nginx 实例。继续启动两个容器：

```bash
docker run -d --name k8s-study-web-2 -p 127.0.0.1:8082:80 nginx:alpine
docker run -d --name k8s-study-web-3 -p 127.0.0.1:8083:80 nginx:alpine
```

列出本次实验的所有容器：

```bash
docker ps \
  --filter name=k8s-study-web \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

输出应该类似：

```text
NAMES              STATUS          PORTS
k8s-study-web-3    Up 5 seconds    127.0.0.1:8083->80/tcp
k8s-study-web-2    Up 8 seconds    127.0.0.1:8082->80/tcp
k8s-study-web-1    Up 1 minute     127.0.0.1:8081->80/tcp
```

分别访问三个实例：

```bash
curl -I http://127.0.0.1:8081
curl -I http://127.0.0.1:8082
curl -I http://127.0.0.1:8083
```

三个地址都应该返回 `200 OK`。

现在停下来想一想：我们说“应用有三个实例”，但这个事实目前只存在于人的脑子、操作记录和三个独立的 `docker run` 命令中。系统里没有一个持续生效的规则在表达：

```text
我始终需要 3 个 Web 实例。
```

Docker 知道有三个容器正在运行，但在当前实验中，没有控制器持续保证实例数量必须等于三。

<div id="主动制造一次故障"></div>

## 4. 主动制造一次故障

删除第二个容器，模拟一个应用实例意外消失：

```bash
docker rm -f k8s-study-web-2
```

这里删除的是本章创建的指定实验容器，不会删除 Nginx 镜像，也不会影响其他容器。

再次查看实例数量：

```bash
docker ps \
  --filter name=k8s-study-web \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

现在只剩下 `k8s-study-web-1` 和 `k8s-study-web-3`。

访问刚刚删除的实例：

```bash
curl -I http://127.0.0.1:8082
```

预期会出现连接失败，例如：

```text
curl: (7) Failed to connect to 127.0.0.1 port 8082
```

等待一分钟再运行 `docker ps`，实例仍然只有两个。原因很简单：系统并不知道我们“希望有三个实例”，自然也无法判断当前状态是不是异常。

<div id="Docker-真的完全不能自动重启吗？"></div>

### 4.1 Docker 真的完全不能自动重启吗？

不是。Docker 支持 `--restart` 重启策略，Docker Compose 也可以用配置文件描述一组容器。它们对单机部署非常有用。

但要区分两种情况：

- **进程退出后重启同一个容器**：Docker 重启策略可以处理；
- **在多个节点之间持续维护副本数、选择运行位置、提供统一入口并协调版本发布**：这属于容器编排平台重点解决的问题。

Kubernetes 的价值并不是“Docker 做不到任何自动化”，而是把一组跨应用、跨节点、持续发生的运维动作统一成资源模型和控制机制。

<div id="手动恢复与继续扩容"></div>

## 5. 手动恢复与继续扩容

为了恢复到三个实例，我们必须再次执行创建命令：

```bash
docker run -d --name k8s-study-web-2 -p 127.0.0.1:8082:80 nginx:alpine
```

如果现在需要四个实例，还要继续选择容器名和空闲端口：

```bash
docker run -d --name k8s-study-web-4 -p 127.0.0.1:8084:80 nginx:alpine
```

再检查一次：

```bash
docker ps \
  --filter name=k8s-study-web \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

此时应该有四个容器。

表面上看，扩容只是多执行了一条命令。继续追问，就会出现更多问题：

- 用户应该访问 `8081`、`8082`、`8083` 还是 `8084`？
- 谁负责把请求均匀分配到多个实例？
- 某个实例被删除后，谁来发现并恢复？
- 如果有十台服务器，新容器应该放在哪台机器上？
- 某台服务器宕机后，它上面的实例应该迁移到哪里？
- 发布新版本时，怎样逐步替换旧实例，而不是一起停止？
- 如果新版本启动失败，怎样停止发布并回滚？
- 配置、密码和持久化数据应该放在哪里？
- 谁记录每次变更，谁有权限执行这些操作？

这些问题已经超出了“能否启动一个容器”的范围。

<div id="手工运维的核心困难"></div>

## 6. 手工运维的核心困难

刚才的实验暴露了六类问题。

<!-- 保留原有带编号标题的锚点，兼容已分享的章节链接。 -->
<div id="1-实例数量依赖人工维护"></div>

<div id="实例数量依赖人工维护"></div>

### 6.1 实例数量依赖人工维护

我们想要三个实例，实际只剩两个，但系统不会主动纠正。值班人员必须先发现问题，再执行恢复命令。

<div id="2-每个实例都需要单独寻址"></div>

<div id="每个实例都需要单独寻址"></div>

### 6.2 每个实例都需要单独寻址

四个容器对应四个端口。客户端不应该记住每个实例的地址，更不应该在实例变化时跟着修改配置。

<div id="3-运行位置需要人工选择"></div>

<div id="运行位置需要人工选择"></div>

### 6.3 运行位置需要人工选择

单机实验只需要找一个空闲端口。进入多节点环境后，还要考虑每台机器的 CPU、内存、磁盘、可用区和已有负载。

<div id="4-更新过程容易中断服务"></div>

<div id="更新过程容易中断服务"></div>

### 6.4 更新过程容易中断服务

如果逐个删除旧容器并创建新容器，需要自行控制顺序、健康检查、可用实例数量和回滚时机。

<div id="5-操作过程缺少统一模型"></div>

<div id="操作过程缺少统一模型"></div>

### 6.5 操作过程缺少统一模型

启动、扩容、恢复、暴露端口可能由不同脚本完成。脚本告诉系统“现在执行哪些步骤”，但不一定持续表达“最终应该是什么状态”。

<div id="6-规模越大，组合复杂度越高"></div>

<div id="规模越大，组合复杂度越高"></div>

### 6.6 规模越大，组合复杂度越高

真正的系统不只有 Nginx，还会有 API、数据库、缓存、消息队列和定时任务。每增加一个服务，部署、网络、配置、权限和监控之间的关系都会继续增长。

<div id="Kubernetes-的核心答案：声明期望状态"></div>

## 7. Kubernetes 的核心答案：声明期望状态

Kubernetes 最重要的思维变化是：

> 不再主要告诉系统每一步具体怎么做，而是声明最终希望得到什么。

例如，我们不再反复执行三条创建命令，而是提交一个类似下面的 Deployment 配置：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notes-web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notes-web
  template:
    metadata:
      labels:
        app: notes-web
    spec:
      containers:
        - name: web
          image: nginx:alpine
          ports:
            - containerPort: 80
```

现在不需要记住全部字段，这段 YAML 只是一个预览。先抓住最重要的一行：

```yaml
replicas: 3
```

它表达的是“期望状态”：我希望这个应用始终有三个副本。

<div id="期望状态与实际状态"></div>

### 7.1 期望状态与实际状态

可以把 Kubernetes 的工作简化为下面的循环：

```text
读取期望状态 → 观察实际状态 → 计算差异 → 执行动作 → 再次观察
```

假设期望副本数是 3：

| 时刻 | 期望状态 | 实际状态 | 控制器动作 |
| --- | ---: | ---: | --- |
| 刚提交配置 | 3 | 0 | 创建 3 个实例 |
| 正常运行 | 3 | 3 | 不需要操作 |
| 一个实例故障 | 3 | 2 | 创建 1 个新实例 |
| 手动改为 5 个副本 | 5 | 3 | 再创建 2 个实例 |
| 手动改为 2 个副本 | 2 | 5 | 有控制地减少 3 个实例 |

这里的关键不只是自动创建，而是**持续对比**。只要期望状态和实际状态不一致，控制器就会尝试让它们重新接近。

这种不断观察和纠正的机制叫作**控制循环**，也常被称为 **Reconciliation Loop（调谐循环）**。

<div id="什么是声明式管理"></div>

## 8. 什么是声明式管理

为了理解“声明式”，可以对比两种表达方式。

<div id="命令式：告诉系统每一步怎么做"></div>

### 8.1 命令式：告诉系统每一步怎么做

```text
1. 在服务器 A 创建容器 1
2. 在服务器 A 创建容器 2
3. 在服务器 B 创建容器 3
4. 修改负载均衡器配置
5. 重载负载均衡器
```

命令式方式关注执行过程。如果第三步失败，需要操作者决定从哪里继续、哪些步骤需要撤销。

<div id="声明式：告诉系统最终要什么"></div>

### 8.2 声明式：告诉系统最终要什么

```text
notes-web 使用 nginx:alpine 镜像
需要 3 个副本
每个副本提供 80 端口
通过一个稳定的服务入口访问
```

声明式方式关注目标。控制器根据当前情况决定具体动作，并不断检查结果。

声明式不等于完全不执行命令，也不等于系统永远不会失败。它的价值是把“目标”保存下来，让自动化控制器可以重复、持续、幂等地执行纠正动作。

<div id="Pod、Deployment、Service-分别做什么"></div>

## 9. Pod、Deployment、Service 分别做什么

初学 Kubernetes 时，经常会把这三个对象混在一起。可以先这样理解。

<div id="Pod：应用运行的基本单元"></div>

### 9.1 Pod：应用运行的基本单元

Pod 是 Kubernetes 中可以创建和调度的最小工作负载单元。一个 Pod 通常包含一个主容器，也可以包含需要紧密协作的辅助容器。

可以暂时把 Pod 想成“一个应用实例的运行外壳”，但不要直接把 Pod 等同于 Docker 容器：

- 一个 Pod 可以包含多个容器；
- 同一 Pod 内的容器共享网络环境；
- Pod 有自己的生命周期和 IP；
- Pod 通常被设计为可替换，而不是永久不变。

<div id="Deployment：维护无状态应用副本"></div>

### 9.2 Deployment：维护无状态应用副本

Deployment 用来描述和管理一组应用 Pod。它关心：

- 应该运行多少个副本；
- 每个副本使用什么镜像和配置；
- 如何逐步发布新版本；
- 版本异常时如何暂停或回滚。

在前面的实验中，“始终保持三个 Nginx 实例”就是 Deployment 适合表达的目标。

<div id="Service：提供稳定访问入口"></div>

### 9.3 Service：提供稳定访问入口

Pod 可能被删除并重新创建，新 Pod 的 IP 也可能变化。客户端如果直接记录 Pod IP，就会不断遇到失效地址。

Service 为一组符合条件的 Pod 提供稳定的访问入口和服务发现能力。它通过标签选择后端 Pod，把请求转发给当前可用的实例。

可以先记住这组关系：

```text
Deployment 负责“有几个、是什么版本”
Pod        负责“应用实例在哪里运行”
Service    负责“其他人怎样稳定访问这些实例”
```

<div id="一个请求背后的协作过程"></div>

## 10. 一个请求背后的协作过程

假设我们向 Kubernetes 提交了一个需要三个副本的 Deployment，可以把背后的协作过程理解为：

1. 用户通过 kubectl 或其他客户端把资源配置提交给 API Server；
2. API Server 校验请求，并将集群状态保存到 etcd；
3. Deployment 等控制器发现期望三个副本，但当前副本不足；
4. 控制器创建需要的 Pod 记录；
5. Scheduler 为尚未分配节点的 Pod 选择合适节点；
6. 对应节点上的 kubelet 发现新任务，调用容器运行时启动容器；
7. Service 和集群网络为这些 Pod 提供稳定访问方式；
8. 控制器与 kubelet继续观察状态，发现偏差后再次处理。

这不是一次执行完就结束的脚本，而是一组长期运行、各司其职的控制循环。

<div id="集群由哪些部分组成"></div>

## 11. 集群由哪些部分组成

Kubernetes 集群大体分为**控制平面**和**工作节点**。

<div id="控制平面"></div>

### 11.1 控制平面

控制平面负责接收意图、保存状态和作出全局决策。

| 组件 | 初学阶段可以这样理解 |
| --- | --- |
| kube-apiserver | 集群统一入口，接收和校验 API 请求 |
| etcd | 保存 Kubernetes API 中的集群状态 |
| kube-scheduler | 为尚未分配节点的 Pod 选择运行位置 |
| kube-controller-manager | 运行多种控制器，持续协调期望状态和实际状态 |
| cloud-controller-manager | 在云环境中连接云厂商提供的节点、路由、负载均衡等能力；本地集群不一定有 |

<div id="工作节点"></div>

### 11.2 工作节点

工作节点是真正运行应用负载的机器。

| 组件 | 初学阶段可以这样理解 |
| --- | --- |
| kubelet | 节点上的管理代理，确保分配到本节点的 Pod 按要求运行 |
| 容器运行时 | 实际拉取镜像、创建和运行容器，例如 containerd |
| 网络数据面 | 实现 Pod 通信和 Service 转发，可能由 kube-proxy 或其他网络方案承担 |

现在不需要死记所有组件。更重要的是理解信息流：

```text
用户提交期望 → 控制平面保存并决策 → 工作节点执行 → 状态返回控制平面 → 控制器继续协调
```

<div id="Kubernetes-具体解决什么问题"></div>

## 12. Kubernetes 具体解决什么问题

<div id="服务发现与负载分配"></div>

### 12.1 服务发现与负载分配

应用通过稳定名称访问 Service，不需要知道每个 Pod 的临时 IP。Service 将流量发送到当前匹配且可用的后端实例。

<div id="自动调度"></div>

### 12.2 自动调度

Scheduler 根据资源需求、节点容量和调度约束为 Pod 选择节点。运维人员不必为每个新实例手工挑选服务器。

<div id="自愈"></div>

### 12.3 自愈

当容器进程退出时，节点上的 kubelet 可以按照 Pod 的重启策略重启容器；当 Pod 消失、健康检查持续失败或节点不可用时，Deployment 等控制器可以创建替代 Pod，并在可用节点上补足副本。

“自愈”恢复的是 Kubernetes 能观察和表达的运行状态，不代表它能自动修复所有业务错误。

<div id="水平扩缩容"></div>

### 12.4 水平扩缩容

可以手动调整副本，也可以根据 CPU、内存或自定义指标配置自动扩缩容。扩容的目标不再是“执行若干创建命令”，而是“把期望副本数调整为新的值”。

<div id="滚动更新与回滚"></div>

### 12.5 滚动更新与回滚

Deployment 可以分批创建新版本并移除旧版本，在更新过程中维持一定数量的可用实例。新版本异常时，可以暂停或回滚。

<div id="配置与敏感信息管理"></div>

### 12.6 配置与敏感信息管理

ConfigMap 和 Secret 可以把环境配置与容器镜像分离。不过 Secret 的安全使用仍需要权限控制、加密和外部密钥管理等配套措施。

<div id="存储编排"></div>

### 12.7 存储编排

Kubernetes 提供持久卷相关抽象，让工作负载可以申请和使用存储。底层存储系统仍需要由本地、云平台或外部存储方案提供。

<div id="统一的资源模型和-API"></div>

### 12.8 统一的资源模型和 API

应用、配置、权限、网络和存储都可以通过 Kubernetes API 管理。这为审计、自动化和 GitOps 等实践提供了统一入口。

<div id="Kubernetes-不会自动解决什么"></div>

## 13. Kubernetes 不会自动解决什么

了解边界和了解能力同样重要。

<div id="不会修复应用代码"></div>

### 13.1 不会修复应用代码

如果代码存在死循环、内存泄漏或业务逻辑错误，Kubernetes 最多尝试重启或替换实例。不断重启并不等于问题被解决。

<div id="不会自动让数据库变成高可用"></div>

### 13.2 不会自动让数据库变成高可用

多运行几个数据库 Pod，不代表数据就能正确复制，也不代表主从切换和一致性问题已经解决。数据库高可用需要数据库自身机制和经过验证的运维方案。

<div id="不会自动提供完整监控体系"></div>

### 13.3 不会自动提供完整监控体系

Kubernetes 暴露状态和事件，也能与日志、指标、追踪系统集成，但不会替你确定监控目标、告警阈值和故障响应流程。

<div id="不会替代-CI-CD"></div>

### 13.4 不会替代 CI/CD

Kubernetes 可以接收新镜像并执行发布，但代码构建、测试、镜像扫描、审批和发布策略仍需要 CI/CD 流程。

<div id="不会消除分布式系统复杂度"></div>

### 13.5 不会消除分布式系统复杂度

网络延迟、部分失败、数据一致性、容量规划和安全边界依然存在。Kubernetes 提供统一管理方式，也会引入新的学习和运维成本。

<div id="从传统部署到-Kubernetes"></div>

## 14. 从传统部署到 Kubernetes

| 阶段 | 主要管理对象 | 优势 | 典型困难 |
| --- | --- | --- | --- |
| 物理机部署 | 服务器和进程 | 结构直接 | 资源利用率低、环境隔离弱、扩容慢 |
| 虚拟机部署 | 虚拟机和进程 | 隔离更强、资源分配灵活 | 镜像较重、启动慢、交付环境仍可能不一致 |
| 容器部署 | 镜像和容器 | 交付一致、启动快、资源开销较小 | 多实例、多节点、发布和服务发现需要额外管理 |
| Kubernetes | 声明式资源对象 | 持续协调、调度、自愈、扩缩容和统一 API | 平台本身复杂，需要规范、监控和运维能力 |

容器解决的是“应用及其依赖如何被一致地打包和运行”。Kubernetes 进一步解决的是“许多容器如何在一组机器上长期、稳定、可控地运行”。

<div id="什么情况下暂时不需要-Kubernetes"></div>

## 15. 什么情况下暂时不需要 Kubernetes

Kubernetes 很强，但不是所有项目的默认答案。下面这些场景通常可以先使用更简单的方案：

- 只有一个或少量服务；
- 只部署在一台服务器；
- 停机几分钟可以接受；
- 发布频率很低；
- 团队暂时没有维护集群的能力；
- Docker Compose 或托管平台已经能够满足需求。

使用 Kubernetes 的收益应该覆盖它引入的复杂度。如果只是部署一个静态博客，使用 GitHub Pages、对象存储或普通 Web 服务器通常更简单。

适合认真考虑 Kubernetes 的信号包括：

- 服务和实例数量持续增长；
- 需要跨节点调度和故障迁移；
- 需要稳定的滚动发布、回滚和弹性伸缩；
- 多个团队希望使用统一的部署接口；
- 已经具备监控、权限、备份和平台维护能力。

<div id="常见误区"></div>

## 16. 常见误区

<div id="误区一：Kubernetes-就是更高级的-Docker"></div>

### 16.1 误区一：Kubernetes 就是更高级的 Docker

Docker 重点覆盖镜像构建和容器运行体验；Kubernetes 重点管理集群中的工作负载。二者关注层次不同。

Kubernetes 通过容器运行时接口使用 containerd、CRI-O 等运行时，并不要求节点必须安装 Docker Engine。

<div id="误区二：Pod-就等于容器"></div>

### 16.2 误区二：Pod 就等于容器

Pod 是 Kubernetes 的调度和运行单元，一个 Pod 可以包含一个或多个共享网络和部分资源的容器。

<div id="误区三：有多个副本就一定高可用"></div>

### 16.3 误区三：有多个副本就一定高可用

如果所有副本都在同一个节点、依赖同一个故障点，或者应用本身不支持水平扩展，多个副本仍可能一起失效。

<div id="误区四：自愈就是自动修复所有问题"></div>

### 16.4 误区四：自愈就是自动修复所有问题

Kubernetes 可以恢复可观察的运行状态，例如补足副本。它不能理解“订单金额算错了”这样的业务语义。

<div id="误区五：用了-Kubernetes-就不需要运维"></div>

### 16.5 误区五：用了 Kubernetes 就不需要运维

集群升级、安全修复、容量管理、监控、备份和故障演练仍然需要持续投入，只是管理方式发生了变化。

<div id="清理本章实验资源"></div>

## 17. 清理本章实验资源

确认不再需要四个实验容器后，执行：

```bash
docker rm -f \
  k8s-study-web-1 \
  k8s-study-web-2 \
  k8s-study-web-3 \
  k8s-study-web-4
```

不支持反斜杠换行的终端可以使用一行命令：

```bash
docker rm -f k8s-study-web-1 k8s-study-web-2 k8s-study-web-3 k8s-study-web-4
```

验证容器已经清理：

```bash
docker ps -a --filter name=k8s-study-web
```

如果表格中没有实验容器，说明清理完成。`nginx:alpine` 镜像会保留在本地，后续仍可使用；如需删除镜像，可以单独执行 `docker image rm nginx:alpine`，但这不是本章必须步骤。

<div id="常见问题排查"></div>

## 18. 常见问题排查

<div id="容器名称已经存在"></div>

### 18.1 容器名称已经存在

错误信息可能包含：

```text
Conflict. The container name is already in use.
```

先查看已有容器：

```bash
docker ps -a --filter name=k8s-study-web
```

如果确认它们是上一次实验遗留的容器，再执行本章的清理命令后重试。

<div id="端口已经被占用"></div>

### 18.2 端口已经被占用

错误信息可能包含：

```text
port is already allocated
```

可以停止占用端口的程序，或者把本机端口统一换成其他空闲值，例如把 `8081:80` 改成 `9081:80`。容器内部的 Nginx 端口仍然是 `80`。

<div id="无法拉取-nginx-alpine"></div>

### 18.3 无法拉取 nginx:alpine

先检查网络和 Docker 服务：

```bash
docker info
docker pull nginx:alpine
```

如果处在需要代理或镜像加速的网络环境，应先完成 Docker daemon 的网络配置，再继续实验。

<div id="curl-无法访问，但容器正在运行"></div>

### 18.4 curl 无法访问，但容器正在运行

依次检查：

```bash
docker ps --filter name=k8s-study-web
docker logs k8s-study-web-1
docker port k8s-study-web-1
```

确认容器状态为 `Up`，日志没有明显错误，并且端口映射与访问地址一致。

<div id="本章关键术语"></div>

## 19. 本章关键术语

| 术语 | 一句话解释 |
| --- | --- |
| Cluster | 一组由 Kubernetes 管理的计算、网络和存储资源 |
| Node | 集群中的一台工作机器，可以是物理机或虚拟机 |
| Control Plane | 保存集群状态、接收请求并作出调度和控制决策的组件集合 |
| Pod | Kubernetes 中可创建和调度的最小工作负载单元 |
| Deployment | 管理一组应用 Pod 的副本、更新和回滚 |
| Service | 为一组变化的 Pod 提供稳定访问入口 |
| Desired State | 用户声明的目标状态，例如“始终运行三个副本” |
| Actual State | 集群当前观察到的真实状态 |
| Controller | 持续比较期望状态和实际状态并尝试缩小差异的程序 |
| Reconciliation | 控制器观察、比较、执行纠正并再次观察的过程 |
| Scheduler | 为未分配节点的 Pod 选择运行位置的控制平面组件 |
| kubelet | 工作节点上的代理，确保分配到本节点的 Pod 按要求运行 |

<div id="本章复盘"></div>

## 20. 本章复盘

如果只记住一件事，请记住：

> Kubernetes 的核心不是“更方便地执行容器启动命令”，而是保存期望状态，并通过持续运行的控制循环让实际状态向期望状态靠拢。

把本章实验对应回 Kubernetes：

| 手工实验中的问题 | Kubernetes 中的对应能力 |
| --- | --- |
| 手工记住需要几个容器 | Deployment 的 `replicas` |
| 容器消失后人工恢复 | 控制器补足 Pod 副本 |
| 手工选择机器和端口 | Scheduler 与集群网络 |
| 客户端记住多个实例地址 | Service 与服务发现 |
| 手工逐个替换版本 | Deployment 滚动更新与回滚 |
| 多套脚本表达操作步骤 | Kubernetes API 与声明式资源清单 |

<div id="自测题"></div>

## 21. 自测题

先尝试不用翻看正文回答：

1. Docker 已经可以运行容器，Kubernetes 为什么仍然有价值？
2. “期望状态”和“实际状态”分别是什么？
3. 控制循环为什么不是一次性脚本？
4. Pod、Deployment、Service 的职责有什么区别？
5. 删除一个由 Deployment 管理的 Pod 后，为什么通常会出现一个新 Pod？
6. Kubernetes 的自愈为什么不能修复业务逻辑错误？
7. 一个只有单服务、单服务器的小项目是否一定需要 Kubernetes？为什么？

<details>
<summary>展开参考答案</summary>

1. Docker 解决容器的构建和运行问题；Kubernetes 进一步管理多实例、多节点环境中的调度、服务发现、自愈、扩缩容和发布。
2. 期望状态是用户声明的目标，实际状态是集群当前观察到的状态。
3. 运行环境会不断变化，实例和节点随时可能故障，因此需要持续观察和纠正，而不是只执行一次。
4. Pod 承载应用实例，Deployment 管理 Pod 副本和版本，Service 提供稳定访问入口。
5. 控制器观察到实际副本数少于 Deployment 声明的期望副本数，于是创建新 Pod 补足差异。
6. Kubernetes 只能根据进程、健康检查和资源状态采取动作，无法理解应用内部的业务正确性。
7. 不一定。若简单方案已满足可用性、发布和维护需求，引入 Kubernetes 可能只会增加复杂度。

</details>

## 官方资料

- [Kubernetes 概述](https://kubernetes.io/zh-cn/docs/concepts/overview/)
- [Kubernetes 集群架构](https://kubernetes.io/zh-cn/docs/concepts/architecture/)
- [Kubernetes 控制器](https://kubernetes.io/zh-cn/docs/concepts/architecture/controller/)
- [Deployment](https://kubernetes.io/zh-cn/docs/concepts/workloads/controllers/deployment/)
- [Service](https://kubernetes.io/zh-cn/docs/concepts/services-networking/service/)
- [Docker：docker container run](https://docs.docker.com/reference/cli/docker/container/run/)
- [Docker：docker container rm](https://docs.docker.com/reference/cli/docker/container/rm/)

## 下一章

下一篇：[《使用 kind 创建本地集群》](/k8s-02-kind-cluster/)。我们会安装 kind 和 kubectl，创建 `k8s-lab`，部署并访问第一个应用，再通过选做实验观察控制平面与工作节点。

[返回《K8s学习记录》系列目录](/k8s-learning-notes/)
