---
title: 使用 kind 创建本地集群：从安装工具到访问第一个应用
date: 2026-09-13 10:00:00
updated: 2026-09-13 14:00:00
permalink: k8s-02-kind-cluster/
categories:
  - 云原生
tags:
  - Kubernetes
  - K8s
  - kind
  - kubectl
  - 学习记录
description: 面向初学者的 kind 跟练教程：安装工具、创建本地集群、理解 kubeconfig、观察系统组件、导入镜像、部署并访问第一个应用，附多节点实验、常见故障排查与 kubeadm 生产学习路线。
keywords:
  - kind 本地集群
  - Kubernetes 入门
  - kubectl
  - kubeconfig
  - kubeadm
toc: true
toc_number: false
---

> 本文是《K8s学习记录》系列第 02 篇。[返回系列目录](/k8s-learning-notes/) · [上一章：Kubernetes 解决了什么问题](/k8s-01-why-kubernetes/)

## 本章要完成什么

上一章用 Docker 模拟了手工管理应用实例的过程。这一章，我们真正搭建一个 Kubernetes 集群，让第一章中的“控制平面、节点、Pod、控制循环”变成可以观察的对象。

本章的终点很具体：在自己的电脑上创建 `k8s-lab` 集群，部署一个叫 `notes-app` 的示例 Web 服务，并在浏览器中打开它。

完成后，你应该能够：

- 分清 Docker、kind、kubectl 各自负责什么；
- 创建集群，确认节点和系统组件已经就绪；
- 知道 kubectl 当前连接哪个集群，避免误操作其他环境；
- 把本机镜像导入 kind，通过 YAML 部署应用；
- 使用端口转发访问应用，通过状态、事件、日志排查问题；
- 安全保留或清理实验环境，知道后续学习 kubeadm 应该关注什么。

建议预留 90～120 分钟，首次下载工具和镜像的时间另计。第一次跟练完成第 1～8 节即可；多节点与 kubeadm 部分可以第二次再看。

**阅读约定**：所有终端命令都在你自己的电脑上执行，不需要先进入节点容器。文中的输出是帮助辨认结果的示意，不是读者环境的实测记录；名称后缀、IP、耗时以实际结果为准。某一步未达到验收条件时，先排查，不要继续堆叠后面的命令。

<!-- more -->

## 1. 先理解：我们究竟在电脑上搭建了什么

### 1.1 三个工具，三个职责

| 工具 | 可以怎样理解 | 本章中的职责 |
| --- | --- | --- |
| Docker | 提供运行容器的场地 | 在本机运行 kind 的节点容器 |
| kind | 本地集群的安装和拆除工具 | 创建节点，初始化 Kubernetes，生成连接配置 |
| kubectl | Kubernetes 的命令行客户端 | 向 API Server 提交请求，查看或修改集群资源 |

安装 kubectl 不等于安装了 Kubernetes，就像安装数据库客户端不等于启动了数据库服务器。kind 创建集群后，kubectl 才有本章要连接的服务端。

kind 的名字来自 Kubernetes IN Docker。这里的节点不是三台新购买的服务器，而是容器模拟的节点环境；节点内部运行的 Kubernetes 组件是真实的。

本章先使用一个节点，关系可以这样理解：

```text
你的电脑
├── kubectl ──请求──> Kubernetes API Server
└── Docker 运行环境
    └── k8s-lab-control-plane：一个 kind 节点容器
        ├── 控制平面组件：API Server、etcd、调度器、控制器等
        ├── kubelet：负责本节点上的 Pod 生命周期管理
        └── containerd：运行 Pod 中的容器
            ├── 系统 Pod
            └── notes-app Pod
```

在 macOS / Windows 的 Docker Desktop 中，Linux 容器还运行在 Docker Desktop 管理的 Linux 虚拟机中。你通常不需要进入那台虚拟机。

因此，有两件容易混淆的事：

1. `docker ps` 主要看到外层的 kind 节点容器，不会把所有 Pod 都作为本机 Docker 容器列出来。
2. 本机 Docker 的镜像缓存和节点内部 containerd 的镜像缓存不是同一个仓库。后面会专门完成一次镜像导入。

### 1.2 单节点并不意味着没有控制平面

“控制平面”和“工作负载”是职责划分，不要求学习环境必须分别占一台机器。

kind 的单节点实验环境允许应用调度到控制平面节点。这样一台电脑就能学习资源创建和控制循环。真实集群通常会把业务工作负载与控制平面隔离；不要由这个实验推导出“生产也应该把所有东西放到一个节点”。

Kubernetes 的通用组件关系可以对照[官方集群架构说明](https://kubernetes.io/docs/concepts/architecture/)阅读。

## 2. 准备环境与安装工具

### 2.1 先确认电脑条件

本章主线面向 macOS 或 Linux 的 Bash / Zsh 终端。Windows 用户可使用 WSL2 的 Linux 终端，并在 Docker Desktop 中开启对应发行版的 WSL 集成；不要一会儿在 Windows 安装工具、一会儿又在 WSL 里寻找它们。

资源方面，建议给 Docker 环境预留约 4 核 CPU、6 GB 内存和 15 GB 可用磁盘空间。它们是本教程为减少卡顿给出的起步建议，不是 Kubernetes 的官方最低要求；同时运行大型 IDE、数据库或者多节点实验时，应适当增加资源。电脑吃紧就先完成单节点主线。

macOS 可按 [Docker Desktop 安装说明](https://docs.docker.com/desktop/setup/install/mac-install/)安装并启动。Linux 可按 [Docker Engine 安装入口](https://docs.docker.com/engine/install/)选择自己的发行版。Windows / WSL2 环境参考 [Docker WSL2 后端说明](https://docs.docker.com/desktop/features/wsl/)。

**不需要开启 Docker Desktop 自带的 Kubernetes**。本章由 kind 单独创建集群，两个功能同时启用只会增加资源占用与上下文混淆的机会。

安装或启动 Docker 后，在准备跟练的终端执行：

```bash
docker version
docker info --format '{{.OSType}}/{{.Architecture}}'
```

检查两件事：

- `docker version` 同时有 Client 和 Server 信息；只有客户端版本，不能证明容器引擎正在工作。
- 操作系统应为 `linux`。架构可能显示 `aarch64`、`arm64` 或 `x86_64` 等，取决于环境。

Linux 上若提示 Docker socket 权限不足，先按官方安装文档配置当前用户访问权限。加入 `docker` 组通常意味着拥有接近 root 的管理能力，不要用 `chmod 666 /var/run/docker.sock` 给所有用户开放访问。

### 2.2 本文的版本约定

为了方便复现，本章使用以下明确的版本组合，**不是要求生产环境长期停留在这些版本**：

| 项目 | 本文约定 |
| --- | --- |
| kind | `v0.33.0` |
| Kubernetes 节点镜像 | `kindest/node:v1.35.8`，在配置中同时固定 digest |
| kubectl | `v1.35.8` |
| 示例 Web 镜像 | `nginxinc/nginx-unprivileged:1.28-alpine` |

节点镜像来自 [kind v0.33.0 发布说明](https://github.com/kubernetes-sigs/kind/releases/tag/v0.33.0)的兼容镜像列表。kind 的版本和 Kubernetes 的版本不是一回事；`v0.33.0` 是安装工具的版本，`v1.35.8` 是本次运行的 Kubernetes 版本。

kubectl 与 API Server 的次版本差不能超过 1。例如，1.35 的客户端可以搭配 1.34～1.36 的服务端，但不能因为“命令能执行”就忽略更大的版本差。本章使用相同版本减少变量。[官方 kubectl 安装与兼容性说明](https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/)

如果你已有兼容版本的工具，可以跳过相应安装步骤。若要切换整套版本，应一起核对 kind 的兼容镜像列表、镜像 digest 和 kubectl，而不是只把其中一个数字改成“最新”。

### 2.3 macOS / Linux：安装指定版本

先检查是否已经安装：

```bash
kind version
kubectl version --client
```

出现 `command not found` 才表示当前终端找不到对应工具；尚未创建集群时，`kubectl version --client` 也应该能正常显示客户端版本。

下面使用官方二进制文件安装。先根据电脑选择变量，**下列四组只执行与你环境相符的一组**：

```bash
# Apple Silicon Mac，例如 M1 / M2 / M3 / M4
LAB_OS=darwin
LAB_ARCH=arm64
```

```bash
# Intel Mac
LAB_OS=darwin
LAB_ARCH=amd64
```

```bash
# 常见 Intel / AMD Linux，uname -m 通常为 x86_64
LAB_OS=linux
LAB_ARCH=amd64
```

```bash
# ARM64 Linux，uname -m 通常为 aarch64
LAB_OS=linux
LAB_ARCH=arm64
```

不确定时先执行 `uname -s` 和 `uname -m`。WSL2 按 Linux 选择，不按 Windows 选择。

在同一个终端继续执行：

```bash
LAB_DOWNLOAD_DIR=$(mktemp -d)
cd "$LAB_DOWNLOAD_DIR"
curl -fLO "https://github.com/kubernetes-sigs/kind/releases/download/v0.33.0/kind-${LAB_OS}-${LAB_ARCH}"
curl -fLO "https://github.com/kubernetes-sigs/kind/releases/download/v0.33.0/kind-${LAB_OS}-${LAB_ARCH}.sha256sum"
curl -fLo kubectl "https://dl.k8s.io/release/v1.35.8/bin/${LAB_OS}/${LAB_ARCH}/kubectl"
curl -fLo kubectl.sha256 "https://dl.k8s.io/release/v1.35.8/bin/${LAB_OS}/${LAB_ARCH}/kubectl.sha256"
```

`curl -f` 会在 HTTP 错误时报告失败，`-L` 用于跟随下载重定向。任何一个下载失败都先处理，不要继续安装不完整文件。

随后校验下载内容。macOS 执行：

```bash
shasum -a 256 -c "kind-${LAB_OS}-${LAB_ARCH}.sha256sum"
printf '%s  kubectl\n' "$(cat kubectl.sha256)" | shasum -a 256 -c -
```

Linux 执行：

```bash
sha256sum -c "kind-${LAB_OS}-${LAB_ARCH}.sha256sum"
printf '%s  kubectl\n' "$(cat kubectl.sha256)" | sha256sum -c -
```

两项都应出现 `OK`。校验失败时重新检查版本、架构和下载来源，不要通过跳过校验继续安装。

确认后，把工具安装到自己的用户目录。若该位置已有你维护的同名工具，先检查版本并决定是否替换：

```bash
mkdir -p "$HOME/.local/bin"
install -m 0755 "kind-${LAB_OS}-${LAB_ARCH}" "$HOME/.local/bin/kind"
install -m 0755 kubectl "$HOME/.local/bin/kubectl"
export PATH="$HOME/.local/bin:$PATH"
kind version
kubectl version --client
command -v kind
command -v kubectl
```

`PATH` 是终端查找命令的目录列表；把新目录放在前面，可以避免误用 Docker Desktop 或其他软件附带的旧版本。这里的 `export` 只对当前终端有效。验证成功后，可用编辑器把这一行加入 Zsh 的 `~/.zshrc` 或 Bash 的 `~/.bashrc`，不要重复添加很多次。

下载目录只是临时文件目录。后面会切换到自己的实验目录，不要把 YAML 长期保存在这里。

### 2.4 Windows 原生 PowerShell 用户

如果不使用 WSL2，请按 [kind 安装说明](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)和 [Windows kubectl 安装说明](https://kubernetes.io/docs/tasks/tools/install-kubectl-windows/)安装 Windows 二进制文件，选择与本章匹配的版本并验证校验和。

后面的 `kind`、`kubectl` 和 YAML 内容可以继续使用，但不要直接复制上一节 Bash 的变量赋值和 `export`。指定 Docker provider 时，PowerShell 使用：

```powershell
$env:KIND_EXPERIMENTAL_PROVIDER = "docker"
```

在浏览器访问阶段直接使用浏览器即可；如果需要命令行请求，使用 `curl.exe`，避免旧版 PowerShell 的 `curl` 别名带来参数差异。全文不要混用 WSL 和 Windows 的 kubeconfig。

## 3. 创建第一个 kind 集群

### 3.1 准备一个独立的实验目录

选择自己的学习目录，执行：

```bash
mkdir k8s-ch02
cd k8s-ch02
```

若目录已存在，直接进入并检查已有文件，不要覆盖之前的实验记录。本章所有 YAML 都用文本编辑器保存为 UTF-8 纯文本，注意不是 `xxx.yaml.txt`。

### 3.2 编写集群配置

新建 `kind-cluster.yaml`，完整内容如下：

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  apiServerAddress: "127.0.0.1"
nodes:
  - role: control-plane
    image: kindest/node:v1.35.8@sha256:07b2536e30b803ed61d1677a79df6115f798ce64c80f9e22f6ed45afd09323c0
```

先认识四个信息：

- `kind: Cluster`：告诉 kind 这是集群配置。
- `apiVersion`：kind 配置文件的格式版本，**不是 Kubernetes 的版本号**。
- `apiServerAddress: "127.0.0.1"`：管理入口只绑定本机回环地址，不暴露给局域网或公网。
- `nodes`：节点列表，本次只创建一个控制平面节点。镜像的 `@sha256:...` 用来固定具体镜像内容。

这是交给 **kind** 读取的文件，不要用 `kubectl apply -f kind-cluster.yaml`。后面交给 kubectl 的应用清单是另一种配置。配置字段可查阅 [kind Configuration](https://kind.sigs.k8s.io/docs/user/configuration/)。

### 3.3 创建并等待

macOS / Linux 在当前终端指定 Docker，然后创建集群；PowerShell 用前一节的环境变量写法：

```bash
export KIND_EXPERIMENTAL_PROVIDER=docker
kind get clusters
kind create cluster --name k8s-lab --config kind-cluster.yaml --wait 5m
```

如果 `kind get clusters` 已列出 `k8s-lab`，说明同名集群已经存在。先检查它，不要为了重跑命令立刻删除；只有明确它是可丢弃的实验集群时，才按后文清理步骤重建。

创建过程大致会经历：准备节点镜像、启动节点容器、初始化控制平面、安装集群网络与存储相关组件、写入连接配置。第一次耗时往往主要在下载，不是每次都需要重新下载。

`--wait 5m` 会等待控制平面就绪，但不是整条命令从启动到结束的五分钟总预算，前面的镜像下载也会花时间。[kind 创建集群说明](https://kind.sigs.k8s.io/docs/user/quick-start/#creating-a-cluster)

创建成功后，执行：

```bash
kind get clusters
kubectl --context kind-k8s-lab cluster-info
kubectl --context kind-k8s-lab wait --for=condition=Ready nodes --all --timeout=180s
kubectl --context kind-k8s-lab get nodes -o wide
docker ps --filter name=k8s-lab
```

节点列表应类似：

```text
NAME                    STATUS   ROLES           AGE   VERSION
k8s-lab-control-plane   Ready    control-plane   2m    v1.35.8
```

`-o wide` 还会显示节点 IP、系统、内核和容器运行时等列。重点是只有预期节点、状态为 `Ready`、版本符合约定；节点 IP 不要求和他人的电脑相同。

**本节验收**：kind 能列出 `k8s-lab`，kubectl 能连接它，节点 Ready，Docker 中能找到对应的节点容器。这几个检查分别验证了不同层面，不能用其中一个代替全部。

## 4. 认识 kubeconfig：先确认连的是谁，再执行命令

创建集群时，kind 会生成访问配置，默认配置通常位于用户目录下的 `.kube/config`；如果你设置了 `KUBECONFIG`，读写位置可能不同。文件包含集群地址、用户认证信息和上下文，不是普通的无敏感信息配置文件。

一个 context 可以理解为一张连接卡片：**连接哪个集群 + 使用哪个身份 + 默认在哪个命名空间操作**。[官方 kubeconfig 说明](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/)

```bash
kubectl config get-contexts
kubectl config current-context
```

你可能同时看到 `docker-desktop`、`kind-k8s-lab` 或公司的集群。星号表示当前默认上下文。注意名称区别：

| 名称 | 值 | 用在哪里 |
| --- | --- | --- |
| kind 集群名称 | `k8s-lab` | `kind --name` 相关操作 |
| kubectl 上下文名称 | `kind-k8s-lab` | `kubectl --context` |
| Kubernetes 节点名称 | `k8s-lab-control-plane` | 查看或描述节点 |
| 本系列命名空间 | `k8s-learning` | 隔离本系列应用资源 |

本章刻意在涉及集群的 kubectl 命令中保留 `--context kind-k8s-lab`。虽然命令长一点，但你可以一眼看出操作目标，而且不会依赖某次命令是否切换过默认上下文。

不要删除整个 `.kube/config` 来“重置实验”，也不要把它、`kubectl config view --raw` 的输出或集群证书上传到公开博客、Git 仓库。需要分享问题时只提供已脱敏的错误和资源状态。

## 5. 在真实集群里找到第一章的组件

先查看命名空间和全部 Pod：

```bash
kubectl --context kind-k8s-lab get namespaces
kubectl --context kind-k8s-lab get pods -A
kubectl --context kind-k8s-lab get pods -n kube-system -o wide
```

`-n kube-system` 表示只看系统命名空间，`-A` 表示查看所有命名空间。节点本身是集群级资源，不属于某个命名空间；Pod、Deployment 等则属于命名空间。

在本章默认配置下，可以寻找这些名字；后面的随机后缀可能不同：

| 常见名称前缀 | 先用一句话记住职责 |
| --- | --- |
| `kube-apiserver` | 接收 Kubernetes API 请求，是管理入口 |
| `etcd` | 保存集群的配置和状态数据 |
| `kube-scheduler` | 为还未分配节点的 Pod 选择节点 |
| `kube-controller-manager` | 运行多种控制器，持续协调实际状态与期望状态 |
| `coredns` | 提供集群内部 DNS 服务 |
| `kindnet` | kind 默认配置中的 Pod 网络组件 |
| `kube-proxy` | 在本章默认配置中实现 Service 转发规则 |

你也可能在 `local-path-storage` 命名空间看到存储 provisioner。它是后续学习本地持久卷时会接触的组件，不意味着已经具备生产级高可用存储。

为什么这里没看到一个叫 kubelet 的 Pod？因为 kind 节点中的 kubelet 是节点进程，不是这个列表中的普通 Pod。也不要把 `kube-proxy` 误解成公网反向代理，它和网站前面的 Nginx 不是同一种职责。

进一步查看节点：

```bash
kubectl --context kind-k8s-lab describe node k8s-lab-control-plane
```

输出很长，第一次只找四块：

1. `Conditions`：节点是否 Ready，是否存在内存、磁盘等压力。
2. `Capacity / Allocatable`：节点总资源与可供 Pod 使用的资源。
3. `Non-terminated Pods`：哪些 Pod 正在这个节点上运行。
4. `Events`：最近发生的调度、启动或异常事件。

不要试图第一天记住所有字段。先建立“概览用 get，详情和事件用 describe”的习惯。

## 6. 部署第一个 notes-app

### 6.1 这一次先用示例 Web 服务

系列后面会逐步实现带 API 和存储的应用。本章的 `notes-app` 暂时用 Nginx 欢迎页代替，目的是验证从配置提交到浏览器访问的完整链路，而不是同时调试业务代码。

示例选择 `nginxinc/nginx-unprivileged:1.28-alpine`：它是面向非 root 运行的 Nginx 镜像，默认监听 **8080**，与上一章普通 Nginx 的 80 端口不同。[镜像维护项目说明](https://github.com/nginx/docker-nginx-unprivileged)

这里明确版本系列以避免无意使用 `latest`，但标签仍可能因补丁和基础镜像重建而变化；需要严格复现或用于生产时，应评估受支持版本、扫描镜像并固定经过验证的 digest。本章的静态欢迎页不构成生产镜像安全背书。

### 6.2 下载镜像，再导入 kind 节点

在本机终端执行：

```bash
docker pull nginxinc/nginx-unprivileged:1.28-alpine
kind load docker-image nginxinc/nginx-unprivileged:1.28-alpine --name k8s-lab
```

第一条把镜像下载到本机 Docker；第二条把它导入指定 kind 集群的节点。后面 YAML 中的镜像名称和标签必须与这里完全相同。

这一步也能把问题分层：如果 `docker pull` 就失败，先处理镜像来源、网络或认证，不要开始修改 Kubernetes 资源。镜像成功导入后再部署，可以减少节点直接访问外部仓库的不确定性。[kind 本地镜像导入说明](https://kind.sigs.k8s.io/docs/user/quick-start/#loading-an-image-into-your-cluster)

### 6.3 创建专用命名空间

新建 `namespace.yaml`：

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: k8s-learning
```

执行：

```bash
kubectl --context kind-k8s-lab apply -f namespace.yaml
kubectl --context kind-k8s-lab get namespace k8s-learning
```

把命名空间暂时理解为集群中组织资源的“分区”，这样不会把学习应用混进 `kube-system`。它本身并不自动提供完整的网络和权限隔离，相关内容会在后续章节展开。

`apply` 会把文件中的目标配置提交给集群。相同文件重复执行通常显示 `unchanged`，而不是每次创建一套重名资源；修改受支持字段后再执行，会更新目标配置。

### 6.4 编写应用清单

新建 `notes-app.yaml`，注意 YAML 使用空格缩进，不要用 Tab：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notes-app
  namespace: k8s-learning
  labels:
    app: notes-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: notes-app
  template:
    metadata:
      labels:
        app: notes-app
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: web
          image: nginxinc/nginx-unprivileged:1.28-alpine
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
          resources:
            requests:
              cpu: 50m
              memory: 32Mi
            limits:
              cpu: 500m
              memory: 128Mi
```

不用立刻背下全部字段，先理解你在声明的事情：

- 资源类型是 `Deployment`，名称 `notes-app`，归属 `k8s-learning`。
- 希望运行两个副本，具体 Pod 由控制器创建和管理。
- `template` 是创建 Pod 的模板，里面定义容器镜像、端口等。
- `selector.matchLabels` 与模板中的 `labels` 一致，管理者才能正确识别目标 Pod。
- `IfNotPresent` 表示节点本地已有对应镜像就使用它；没有才尝试拉取。这与刚才的镜像导入配合使用。
- `containerPort: 8080` 描述容器端口，**不会自动在电脑上开放 8080**，也不会替应用修改监听端口。

这里还有几项小型防护：不挂载应用用不到的 ServiceAccount token、要求非 root 运行、禁止提权、移除额外 Linux capabilities，并使用运行时默认 seccomp 配置。它们不是完整的生产安全方案，但可以避免为了学习就默认给应用过大权限。

资源设置是本实验的起点：`50m` 表示 0.05 个 CPU 核，`500m` 表示 0.5 个核，`Mi` 是内存单位。requests 参与调度容量计算；limits 约束使用上限。CPU 限制可能导致节流，内存超限可能导致容器被 OOM 杀死。这里没有配置只读根文件系统，因为这个镜像还需要可写临时路径；完整加固要同时设计可写卷，不能只机械增加一个字段。

第三章会细讲 YAML、Pod 和容器；Deployment 的发布、扩缩容与回滚会在对应专题里展开。本章先把它们作为可以操作的整体认识。

### 6.5 提交、等待、确认

```bash
kubectl --context kind-k8s-lab apply -f notes-app.yaml
kubectl --context kind-k8s-lab -n k8s-learning rollout status deployment/notes-app --timeout=180s
kubectl --context kind-k8s-lab -n k8s-learning get deployments
kubectl --context kind-k8s-lab -n k8s-learning get pods -o wide
```

期望 Deployment 的 READY 为 `2/2`，两个应用 Pod 的 READY 为 `1/1`，STATUS 为 `Running`。单节点模式下，它们的 NODE 都是 `k8s-lab-control-plane`，这是预期现象。

分清这三个结果：

1. `created`：API 接受了资源创建，不代表镜像已下载或应用已启动。
2. `Running`：Pod 已进入运行阶段，不直接证明 HTTP 页面工作正常。
3. `1/1 Ready`：这个 Pod 中有一个容器，被判定为就绪。本章尚未配置应用 readinessProbe，因此不能把这个状态当作业务健康检查已完备的证据。

Deployment 会通过 ReplicaSet 管理副本。你可以用下面的命令观察它们的对应关系，不必手工创建 ReplicaSet：[官方 Deployment 说明](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)

```bash
kubectl --context kind-k8s-lab -n k8s-learning get deployment,replicaset,pod -l app=notes-app
```

本清单同时给 Deployment 自身和 Pod 模板设置了 `app: notes-app` 标签，方便一起查询。标签只作用于标记了它的对象，不会沿父子关系自动给所有层级补齐。

## 7. 在浏览器中访问应用

### 7.1 保持一个终端运行端口转发

打开终端 A：

```bash
kubectl --context kind-k8s-lab -n k8s-learning port-forward deployment/notes-app 8080:8080 --address 127.0.0.1
```

看到类似输出后，**保持这个终端运行**：

```text
Forwarding from 127.0.0.1:8080 -> 8080
```

`8080:8080` 左侧是电脑上的端口，右侧是所选 Pod 的应用端口。这不是 Docker 的 `-p` 配置，而是 kubectl 建立的一条临时调试通道。

然后在这台电脑的浏览器打开 [http://127.0.0.1:8080](http://127.0.0.1:8080)，应看到 Nginx 欢迎页。在终端 B 也可以检查 HTTP 响应：

```bash
curl -i http://127.0.0.1:8080/
```

期望收到 `HTTP/1.1 200 OK` 和页面内容。Windows 原生终端把 `curl` 换成 `curl.exe`。

如果本机 8080 已被占用，停止原命令，改用：

```bash
kubectl --context kind-k8s-lab -n k8s-learning port-forward deployment/notes-app 8088:8080 --address 127.0.0.1
```

此时浏览器访问 `http://127.0.0.1:8088`，容器的端口仍然是 8080，不需要改 YAML。

### 7.2 这一步证明了什么，没证明什么

成功访问说明：kubectl 能连接集群，选中的 Pod 里 Web 服务正在响应，本机到它的调试链路可用。

但它**没有**证明两个副本都收到了请求，也没有验证 Service 负载均衡、Ingress 或生产对外访问。即使目标写成 `deployment/notes-app`，port-forward 也会选择一个 Pod；该 Pod 消失时通常需要重新启动转发。[官方端口转发说明](https://kubernetes.io/docs/tasks/access-application-cluster/port-forward-access-application-cluster/)

另外，`get pods -o wide` 显示的 Pod IP 是集群网络地址，尤其在 Docker Desktop 环境中，不应假设宿主机浏览器可以直接访问它。本章选择 port-forward，就是为了先把应用本身跑通，网络专题稍后再展开。

这条通道只绑定本机，适合自己的电脑学习。若在远程服务器运行命令，你电脑上的 `127.0.0.1` 并不是那台服务器；需要另行设计受控的 SSH 隧道等访问方式，不要直接把管理入口改成公网监听。

### 7.3 把浏览器请求和应用日志关联起来

在终端 B 执行：

```bash
kubectl --context kind-k8s-lab -n k8s-learning logs -l app=notes-app --all-containers=true --prefix=true --tail=30
```

刷新浏览器后再次执行，寻找 HTTP 请求日志。`--prefix=true` 帮助区分日志来自哪个 Pod 和容器。没有实时滚动是正常的，这条命令只读取已有日志；后续可以再学习 `-f` 持续跟随日志。

**本节验收**：两个 Pod 已运行，浏览器能看到页面，日志中能找到相应请求。只有节点 Ready，还不算完成应用部署实验。

## 8. 做一次小实验：删除 Pod 后会怎样

先在终端 A 按 `Ctrl+C` 停止 port-forward。停止转发只关闭本机访问通道，不会删除应用。

再列出本章的 Pod：

```bash
kubectl --context kind-k8s-lab -n k8s-learning get pods -l app=notes-app
```

从列表里复制一个真实的 Pod 名称。下一条是命令格式，**请替换 `POD_NAME`，不要原样执行，也不要替换成系统 Pod**：

```bash
kubectl --context kind-k8s-lab -n k8s-learning delete pod POD_NAME
```

这会删除选中的实验 Pod 及其临时容器数据。这里只运行无业务数据的欢迎页，可以用来观察控制循环；不要拿真实有状态应用随意练习。

持续观察：

```bash
kubectl --context kind-k8s-lab -n k8s-learning get pods -l app=notes-app -w
```

你会看到旧 Pod 消失、新名称的 Pod 出现，最终又回到两个就绪副本。变化可能很快，不一定能看见每一个中间状态。看完按 `Ctrl+C` 退出观察。

它不是把删除的 Pod“原样复活”，而是控制器根据 `replicas: 2` 创建了替代 Pod。新 Pod 有新的身份，容器的临时文件也不能被当作自动恢复的数据。

再次运行 `rollout status` 确认就绪，然后重新启动上一节的 port-forward，即可再次访问。对照第一章想一想：这次为什么不需要你手工补跑第二个 `docker run`？

## 9. 选做：观察一个三节点集群

单节点已经足够完成本章主线。如果电脑有余量，可以额外创建 `k8s-lab-multi`，观察控制平面与工作节点分开后的结构。建议为两个同时运行的集群增加资源预算；本节不是主线必做项。

新建 `kind-multi.yaml`：

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  apiServerAddress: "127.0.0.1"
nodes:
  - role: control-plane
    image: kindest/node:v1.35.8@sha256:07b2536e30b803ed61d1677a79df6115f798ce64c80f9e22f6ed45afd09323c0
  - role: worker
    image: kindest/node:v1.35.8@sha256:07b2536e30b803ed61d1677a79df6115f798ce64c80f9e22f6ed45afd09323c0
  - role: worker
    image: kindest/node:v1.35.8@sha256:07b2536e30b803ed61d1677a79df6115f798ce64c80f9e22f6ed45afd09323c0
```

执行前确认不存在需要保留的同名集群：

```bash
kind get clusters
kind create cluster --name k8s-lab-multi --config kind-multi.yaml --wait 5m
kubectl --context kind-k8s-lab-multi wait --for=condition=Ready nodes --all --timeout=180s
kubectl --context kind-k8s-lab-multi get nodes -o wide
kubectl --context kind-k8s-lab-multi get pods -n kube-system -o wide
```

正常情况下能看到三个节点：一个 `control-plane` 和两个 worker。worker 在 `ROLES` 列中可能显示 `<none>`，这不表示节点没有作用，而是该列依赖相应的角色标签。

观察哪些组件每个节点都有、哪些只出现在控制平面节点；不要仅凭名称猜测，结合 NODE 列确认。这里没有自动复制主集群的命名空间和应用，两个集群各自保存自己的资源。

本节只观察节点，暂不重复部署应用。如果将来要在这个集群运行本地镜像，必须重新使用 `--name k8s-lab-multi` 导入，并给 kubectl 使用对应上下文。

还要记住：三个节点容器都在同一台电脑上，不能抵御这台电脑宕机；而且这里只有一个控制平面节点，**不是生产高可用集群**。

## 10. 出问题时，按层次排查

不要看到报错就立即 `delete cluster`。先确定失败发生在工具、Docker、集群管理接口、Pod 还是浏览器访问这一层。

### 10.1 工具或集群还没起来

| 现象 | 先检查什么 | 处理方向 |
| --- | --- | --- |
| `kind: command not found` | `command -v kind`、PATH | 确认安装目录已进入当前终端 PATH；新开终端后还需加载配置 |
| `exec format error` | 下载文件与 `uname -m` | amd64 / arm64 或操作系统选错，重新下载匹配的文件 |
| Cannot connect to Docker daemon | `docker version` 是否有 Server | 启动 Docker，确认 WSL 集成、用户权限或 Docker context |
| 下载镜像超时、TLS 错误 | Docker 引擎访问仓库的网络与证书 | 配置可信网络/代理；浏览器能上网不代表 Docker 引擎能上网 |
| 同名集群已存在 | `kind get clusters` | 检查并复用，或确认数据可丢弃后再删除重建 |
| kubectl 连接被拒绝 | context、Docker 是否运行、节点容器是否存在 | 先恢复正确连接；不要通过删除所有 kubeconfig 修复 |
| 节点长期 NotReady | `describe node`、系统 Pod 状态 | 检查网络组件、磁盘/内存压力和启动事件 |

集群创建失败后，若节点还保留着，可以导出日志：

```bash
kind export logs ./kind-logs --name k8s-lab
```

若失败时节点已被自动清理，这个命令无法找回已删除节点的日志。需要重新诊断时，先确认没有同名集群，再使用创建命令的 `--retain` 保留失败节点：

```bash
kind create cluster --name k8s-lab --config kind-cluster.yaml --wait 5m --retain
```

它是诊断时的替代创建方式，不是让你在正常集群上再执行一遍。收集好日志、确认原因后再决定是否清理。日志也可能包含环境信息，分享前要检查并脱敏。[kind 已知问题与排查入口](https://kind.sigs.k8s.io/docs/user/known-issues/)

### 10.2 节点 Ready，但应用不正常

先执行这组命令：

```bash
kubectl --context kind-k8s-lab -n k8s-learning get pods -o wide
kubectl --context kind-k8s-lab -n k8s-learning describe pods -l app=notes-app
kubectl --context kind-k8s-lab -n k8s-learning get events --sort-by=.metadata.creationTimestamp
kubectl --context kind-k8s-lab -n k8s-learning logs -l app=notes-app --all-containers=true --prefix=true --tail=50
```

| 状态或错误 | 怎样理解 | 优先检查 |
| --- | --- | --- |
| `Pending` | 尚未完成调度或启动准备 | describe 中是否提示资源不足、污点、节点不可用 |
| `ContainerCreating` 持续很久 | 容器创建准备未完成 | Events 中的镜像、网络、挂载错误 |
| `ErrImagePull` / `ImagePullBackOff` | 节点获取镜像失败并重试 | 镜像全名、标签、导入目标集群、拉取策略；本机 pull 成功不等于节点已有镜像 |
| `CrashLoopBackOff` | 容器反复退出，重试间隔拉长 | 应用日志、退出原因、权限与端口；不等于“镜像下载慢” |
| `CreateContainerConfigError` | 容器所需配置不成立 | describe 中的具体缺失项或安全上下文错误 |
| `OOMKilled` | 容器因内存问题被杀死 | describe 中上次终止原因，评估内存使用与限制 |
| `No resources found` | 查询范围内没有对应资源 | 是否忘了 `-n k8s-learning`，是否连接另一个集群 |

如果容器已经重启，当前日志可能不是上一次崩溃的日志。复制真实 Pod 名称后查看上一实例：

```bash
kubectl --context kind-k8s-lab -n k8s-learning logs POD_NAME -c web --previous
```

没有上一个容器实例时，这条命令会报相应提示，不说明集群损坏。Events 是有保留期限的事件，不是永久审计记录；发现问题时及时记录。

`rollout status` 超时也不是根因，它只表示在指定时间内没等到目标结果。应回到 Pod 的 describe、Events 和日志，而不是只把超时不断调大。

### 10.3 Pod 正常，但浏览器打不开

按下面顺序核对：

1. port-forward 终端是否仍在运行，是否出现了 `Forwarding from ...`？
2. 浏览器使用的是左侧本机端口吗？本章是 HTTP，不是 HTTPS。
3. 右侧端口是否为这个非 root Nginx 镜像的 **8080**？不要沿用普通 Nginx 的 80。
4. 本机端口是否被占用？尝试 `8088:8080`。
5. 是否刚删除或替换了 Pod？重新运行转发命令。
6. 浏览器与 port-forward 是否在同一台电脑或可达的网络环境中？远程主机、虚拟机、WSL 环境的 localhost 行为需要分别确认。

不需要为此开放 API Server 公网端口、禁用 TLS 校验、关闭所有防火墙，或添加 `privileged: true`。先找到失败链路再处理。

## 11. 学完之后：保留什么，删除什么

### 11.1 推荐：保留主集群进入下一章

建议保留 `k8s-lab`、`k8s-learning` 命名空间和三个 YAML 文件。若下一章想从空白应用环境开始，只删除本章 Deployment 即可：

```bash
kubectl --context kind-k8s-lab -n k8s-learning delete deployment notes-app
kubectl --context kind-k8s-lab -n k8s-learning get pods
```

这会同时触发其管理的 ReplicaSet / Pod 清理，不影响命名空间。终止可能需要一点时间；YAML 仍在，下次可以重新 `apply`。

关闭 port-forward 不会停止 Pod；关闭 Docker 则会让整个本地集群暂时不可访问。再次启动 Docker 后应重新检查节点状态，不要把“笔记本休眠恢复”当作生产可用性验证。

### 11.2 不需要选做集群时，单独清理它

确认 `k8s-lab-multi` 没有需要保留的数据后：

```bash
kind delete cluster --name k8s-lab-multi
kind get clusters
```

它不会删除名称不同的 `k8s-lab`。创建或删除集群后，默认 context 可能不再是你预想的值，继续使用明确的 `--context` 更稳妥。

### 11.3 完全结束实验时才删除主集群

**下面的命令会销毁整个 `k8s-lab`，包括其中所有命名空间、应用和节点内数据。只有确认可丢弃才执行，不是每次学完都必须执行。**

```bash
kind delete cluster --name k8s-lab
kind get clusters
```

本地 YAML 可以帮你重建资源配置，但不是运行数据备份。不要把“有 YAML”理解成“数据库数据也能恢复”。本章没有要求删除整个 Docker 环境、执行全局 prune 或清空 `.kube` 目录。

## 12. 从 kind 走向 kubeadm：生产基础学习索引

### 12.1 kind 没让你处理的事情，不代表生产中不存在

kind 帮我们准备了节点、运行时、引导过程和默认网络，让注意力先集中在 Kubernetes 的行为上。真实机器环境还要处理操作系统、节点连通性、证书、网络规划、升级和故障恢复。

kubeadm 是 Kubernetes 官方提供的集群引导工具，可以帮助初始化控制平面和把节点加入集群；它不会替你完成整个生产平台的所有建设。[kubeadm 创建集群文档](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/)

| 维度 | 本章 kind 实验 | kubeadm 学习中需要面对 |
| --- | --- | --- |
| 节点来源 | 本机 Docker 容器 | 独立 Linux 虚拟机或物理机 |
| 容器运行时 | 节点镜像已准备 | 安装并配置 containerd 等 CRI 运行时 |
| 集群网络 | 本章使用默认网络 | 选择并安装兼容 CNI，规划 Pod / Service 网段 |
| 控制平面可用性 | 单节点，允许随时重建 | 规划 API 入口、多个控制平面节点与 etcd 拓扑 |
| 数据和维护 | 不保存重要数据 | 存储方案、备份恢复、升级、证书与监控 |

### 12.2 建议按这六步补齐知识

1. **准备真实节点环境**：先用独立实验虚拟机学习，确认主机名、IP、时间同步、DNS、端口访问和系统资源。按所选版本要求理解 swap 与 cgroup 配置，不机械复制过期系统调优脚本。
2. **理解运行时链路**：安装 containerd，认识 CRI，以及 kubelet 与运行时的 cgroup 驱动匹配问题。不要把安装 Docker 当作已经完成所有 Kubernetes 运行时配置。
3. **理解 init / join**：知道 kubeadm 如何引导控制平面、节点如何通过受控的 bootstrap 信息加入。加入令牌和管理 kubeconfig 都需要保密。
4. **安装并验证 CNI**：网段不要与宿主机、公司 VPN 或现有网络冲突。验证跨节点 Pod 通信和 DNS；kubeadm 本身不会替你自动选择并安装通用 Pod 网络插件。
5. **学习高可用与恢复**：从多个控制平面节点、稳定 API 入口、etcd 多数派与备份恢复开始。验证故障时能否继续管理集群，而不只是看节点数。
6. **补齐长期维护能力**：理解版本升级顺序、证书生命周期、RBAC、监控告警、容量、镜像来源和变更回滚。生产环境需要这些能力持续工作。

不要现在就拿博客线上服务器试验 `kubeadm init`、更改容器运行时或网络规则。建议等本系列应用层基础完成，再在隔离虚拟机中跟进这条路线。

关键认识是：**kind 帮你学习 Kubernetes 怎样管理应用，kubeadm 让你进一步学习怎样把集群搭在真实节点上；生产能力还包括怎样长期、安全、可靠地维护它。**

## 13. 本章验收与学习记录

### 13.1 实操验收

- [ ] Docker Client 和 Server 均可用，工具版本与架构正确。
- [ ] `k8s-lab` 存在，节点 Ready，可以说出集群名与 context 的区别。
- [ ] 能在系统 Pod 中找到 API Server、etcd、CoreDNS 等组件。
- [ ] 能说明为什么 `docker ps` 看不到与 `kubectl get pods` 相同的列表。
- [ ] 镜像已导入指定 kind 集群，`notes-app` 有两个就绪副本。
- [ ] 浏览器成功访问欢迎页，能在日志中找到请求。
- [ ] 删除一个实验 Pod 后，观察到控制器创建替代 Pod。
- [ ] 知道 port-forward 是临时通道，不是生产服务发布方式。
- [ ] 清楚保留了哪些资源，删除整个集群会丢失哪些内容。

### 13.2 不看文章，回答这八个问题

1. 为什么安装了 kubectl，仍然可能无法执行 `get nodes`？
2. kind 的集群配置和 Kubernetes 的资源清单分别交给谁？
3. 本机 Docker 已经下载镜像，为什么 Pod 还可能拉取失败？
4. 为什么在 `default` 命名空间里看不到刚才部署的应用？
5. `8088:8080` 的两个数字分别指什么？
6. 两个 Pod 都在运行，为什么刷新页面不能证明负载均衡生效？
7. 删除一个 Pod 后自动出现新 Pod，是哪个目标仍然存在？
8. 一台电脑上的三个 kind 节点为什么不等于生产高可用？

<details>
<summary>展开参考答案</summary>

1. kubectl 只是客户端，还需要可达的 API Server、正确的 kubeconfig、上下文和身份权限。
2. `kind-cluster.yaml` 交给 kind 创建集群；Namespace、Deployment 等资源清单交给 kubectl 提交到集群 API。
3. 本机 Docker 与 kind 节点的 containerd 缓存独立；还要检查镜像名称、导入的集群和 `imagePullPolicy`。
4. 本章资源在 `k8s-learning`，需要显式使用 `-n`，或者用 `-A` 查看全部命名空间。
5. 8088 是本机监听端口，8080 是选中 Pod 内应用的端口。
6. port-forward 选择一个 Pod 转发，没有建立或验证 Service 的分流链路。
7. Deployment 声明的两个副本仍然存在，相关控制器会协调实际副本数。
8. 节点共享一台宿主机这一故障点；本章选做配置也只有一个控制平面节点。

</details>

### 13.3 留下自己的实验笔记

建议记录以下内容，不要只收藏成功截图：

```text
实验日期：
电脑系统与架构：
Docker / kind / kubectl / Kubernetes 版本：
使用的集群名与 context：
镜像标签与本次下载的 digest：
第一次卡住的步骤：
看到的状态、事件或日志：
最终原因与处理方式：
哪些资源已经清理，哪些准备留给下一章：
用自己的话解释：一份 YAML 怎样变成浏览器里看到的页面？
```

想查看本机镜像记录的仓库 digest，可以执行：

```bash
docker image inspect nginxinc/nginx-unprivileged:1.28-alpine --format '{{json .RepoDigests}}'
```

这只是记录本次拉取内容；清单仍使用标签，并不会因为执行了 inspect 就自动改成 digest 固定方式。

## 官方资料与下一章

- [kind Quick Start](https://kind.sigs.k8s.io/docs/user/quick-start/)
- [kind 配置说明](https://kind.sigs.k8s.io/docs/user/configuration/)
- [kind v0.33.0 镜像兼容列表](https://github.com/kubernetes-sigs/kind/releases/tag/v0.33.0)
- [Kubernetes：安装 kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Kubernetes：使用端口转发访问应用](https://kubernetes.io/docs/tasks/access-application-cluster/port-forward-access-application-cluster/)
- [Kubernetes：使用 kubeadm 创建集群](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/)

下一章：[《Pod、容器与 YAML 资源清单》](/k8s-03-pod-container-yaml/)。我们会拆开本章先整体使用的资源，详细学习 YAML 字段、Pod 生命周期、日志与进入容器排查。建议保留本章主集群和实验文件，继续跟练。

[上一章：Kubernetes 解决了什么问题](/k8s-01-why-kubernetes/) · [返回《K8s学习记录》系列目录](/k8s-learning-notes/)
