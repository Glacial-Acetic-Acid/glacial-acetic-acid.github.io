---
title: Pod、容器与 YAML 资源清单：从读懂配置到独立排查
date: 2026-09-13 14:00:00
updated: 2026-09-13 14:00:00
permalink: k8s-03-pod-container-yaml/
categories:
  - 云原生
tags:
  - Kubernetes
  - K8s
  - Pod
  - YAML
  - kubectl
  - 学习记录
description: 从零读懂并编写 Kubernetes Pod YAML，掌握 Pod 与容器的关系、声明式操作、状态观察、日志、exec、不可变字段，以及 ImagePullBackOff 和 CrashLoopBackOff 的排查方法。
keywords:
  - Kubernetes Pod
  - Kubernetes YAML
  - kubectl logs
  - kubectl exec
  - Pod 故障排查
toc: true
---

> 本文是《K8s学习记录》系列第 03 篇。[返回系列目录](/k8s-learning-notes/) · [上一章：使用 kind 创建本地集群](/k8s-02-kind-cluster/)

## 本章要完成什么

上一章为了先跑通完整链路，我们直接使用了一份 Deployment 清单。它替我们创建和维护 Pod，但也让一些最基础的问题藏在了背后：

- Pod 和容器是不是同一个东西？
- YAML 中的 `apiVersion`、`kind`、`metadata`、`spec` 分别表示什么？
- `kubectl get` 中的 `Running`、`1/1`、`RESTARTS` 应该怎样解读？
- 应用启动失败时，应该先看状态、事件还是日志？
- `kubectl exec` 究竟做了什么，为什么不能靠进入容器手工改文件发布应用？
- 删除一个直接创建的 Pod，为什么这次不会自动恢复？

本章会从零编写一个独立 Pod，并围绕它完成查看、访问、日志和容器内排查。随后我们会主动制造镜像拉取失败和容器反复退出，练习建立证据链。

完成后，你应该能够：

- 用自己的话解释 Pod 与容器的关系；
- 读懂 Kubernetes 资源清单的通用结构；
- 使用 `kubectl explain` 查询字段，而不是靠记忆猜 YAML；
- 安全地预检、提交、比较和删除资源；
- 区分 Pod phase、容器 state、Conditions 与 kubectl 的 STATUS 列；
- 使用 `get`、`describe`、`logs`、`exec` 和 Events 定位常见问题；
- 解释“直接创建 Pod”和“控制器管理 Pod”的本质差别。

建议预留 90～120 分钟。本文输出均为帮助理解的示意，Pod IP、UID、时间和事件文本以你的环境为准。

<!-- more -->

## 1. 开始前先确认实验环境

### 1.1 本章沿用的约定

本章继续使用：

| 项目 | 约定值 |
| --- | --- |
| kind 集群 | `k8s-lab` |
| kubectl context | `kind-k8s-lab` |
| 命名空间 | `k8s-learning` |
| 本章 Pod | `notes-web` |
| 容器名称 | `web` |
| 容器镜像 | `nginxinc/nginx-unprivileged:1.28-alpine` |
| 应用端口 | `8080` |

所有 kubectl 命令继续显式带上 `--context kind-k8s-lab`，涉及命名空间的命令带上 `-n k8s-learning`。这样即使电脑上还有其他集群，也能看清每一步操作目标。

先执行只读检查：

```bash
kind get clusters
kubectl --context kind-k8s-lab cluster-info
kubectl --context kind-k8s-lab get node
kubectl --context kind-k8s-lab get namespace k8s-learning
```

验收条件是：kind 能列出 `k8s-lab`，节点为 `Ready`，命名空间存在。

如果主集群已经被删除，回到[第二章](/k8s-02-kind-cluster/)重新创建。如果仅缺少命名空间，可重新提交第二章的 `namespace.yaml`，或者执行：

```bash
kubectl --context kind-k8s-lab create namespace k8s-learning
```

若返回 `AlreadyExists`，说明资源已经存在，不需要反复创建。

第二章的 `notes-app` Deployment 是否保留都不影响本章。它创建的 Pod 名称通常带随机后缀；本章直接创建的 Pod 固定叫 `notes-web`，命令中不要混用。

### 1.2 准备本章目录与镜像

新建实验目录并进入：

```bash
mkdir k8s-ch03
cd k8s-ch03
```

如果目录已经存在，进入前先确认里面有没有需要保留的同名 YAML，避免覆盖自己的实验记录。

上一章已导入镜像的读者可以先检查节点缓存：

```bash
docker exec k8s-lab-control-plane crictl images nginxinc/nginx-unprivileged
```

这条命令只用于本地 kind 学习环境：它通过 Docker 进入节点容器，再使用 CRI 工具查看节点镜像。真实生产节点不一定使用 Docker，也不应该套用这条命令。

如果没有结果，或不确定缓存是否还在，重新执行：

```bash
docker pull nginxinc/nginx-unprivileged:1.28-alpine
kind load docker-image nginxinc/nginx-unprivileged:1.28-alpine --name k8s-lab
```

本章仍显式使用版本标签，并配合 `imagePullPolicy: IfNotPresent` 使用本地缓存。严格复现和生产发布还应记录、扫描并固定经过验证的镜像 digest；不要使用不断变化的 `latest`。

## 2. Pod 与容器到底是什么关系

### 2.1 Pod 是 Kubernetes 调度和运行应用的基本单元

容器提供隔离的进程运行环境，而 Pod 是 Kubernetes 包装一个或多个容器的对象。调度器选择节点时，选择的是整个 Pod；Pod 中的容器会一起落到同一个节点上。

可以先这样理解：

```text
Pod：notes-web
├── 身份与元数据：名称、命名空间、标签、UID
├── 网络空间：一个 Pod IP、一组端口
├── 可选的共享卷
└── 容器列表
    └── web：运行 Nginx 进程
```

一个 Pod 可以只有一个容器，这是最常见的情况；也可以包含紧密协作的多个容器。Pod 内的容器共享网络命名空间，因此它们可以通过 `localhost` 和端口互相访问，也可以挂载同一个卷交换文件。[官方 Pod 概念](https://kubernetes.io/docs/concepts/workloads/pods/)

但“关系紧密”不是“碰巧属于同一套业务”。Web、API、数据库通常有不同的扩缩容、资源和发布节奏，不应为了省事塞进一个 Pod。常见的多容器模式是一个主业务容器配合代理、日志处理或配置辅助容器。

### 2.2 Pod 不是一台小型虚拟机

Pod 有 IP、文件系统视图，也能执行 shell 命令，所以初学时容易把它看成虚拟机。这个类比只能帮助入门，不能继续外推：

- Pod 是可替换的资源，不应依赖人工登录后的修改；
- Pod 重建后通常会获得新的 UID 和 IP；
- 容器镜像决定基础文件系统，镜像可能根本没有 Bash、curl 或包管理器；
- Pod 中没有让你长期维护的传统操作系统服务体系；
- 临时写入容器层的文件不会自动成为可靠数据。

Kubernetes 期望我们更新声明和镜像，再由系统创建符合新期望的实例，而不是把线上 Pod 当服务器逐台修改。

### 2.3 直接创建的 Pod 与 Deployment 管理的 Pod

本章直接提交 `kind: Pod`。它有助于学习最底层字段和排查命令，但没有更高层控制器为它维持副本。

| 对比 | 直接创建 Pod | Deployment 管理 Pod |
| --- | --- | --- |
| 谁保存副本期望 | 只有这个 Pod 对象本身 | Deployment / ReplicaSet |
| 手动删除后 | 不会自动补回同名 Pod | 控制器创建替代 Pod |
| 适合 | 学习、短期实验、特定诊断 | 无状态业务应用的常规发布 |
| 滚动更新、扩缩容 | 不负责 | Deployment 提供对应能力 |

Kubernetes 官方也建议实际应用通常通过 Deployment、Job、StatefulSet 等工作负载资源管理 Pod，而不是直接创建裸 Pod。[官方 Pod 工作负载说明](https://kubernetes.io/docs/concepts/workloads/pods/)

## 3. YAML 不难：先抓住结构，再关注字段

### 3.1 一份 Kubernetes 对象的通用骨架

绝大多数资源清单都能从下面的骨架开始阅读：

```yaml
apiVersion: API 组和版本
kind: 资源类型
metadata:
  name: 资源名称
  namespace: 所属命名空间
spec:
  # 你声明的期望配置
```

四个顶层字段分别回答：

| 字段 | 要回答的问题 |
| --- | --- |
| `apiVersion` | 使用哪个 API 组和版本解释这个对象？ |
| `kind` | 要创建哪类资源？ |
| `metadata` | 这个对象是谁、在哪里、带有哪些标记？ |
| `spec` | 希望这个对象怎样运行？ |

`status` 也是常见顶层字段，但通常由 Kubernetes 根据实际状态维护。我们编写期望时主要写 `spec`，查询服务端对象时会看到 `status`。这正是“期望状态”和“实际状态”在对象上的体现。[官方 Kubernetes 对象说明](https://kubernetes.io/docs/concepts/overview/working-with-objects/)

### 3.2 YAML 只需要先掌握四种写法

```yaml
name: notes-web                  # 键值
labels:                          # 嵌套映射
  app: notes-app
ports:                           # 列表
  - name: http
    containerPort: 8080
args: ["nginx", "-g", "daemon off;"]  # 行内列表，能读即可
```

最容易踩坑的是：

1. 缩进表达层级，统一使用空格，不用 Tab。
2. `-` 表示列表项；同一层级的字段要对齐。
3. 字符串看起来像布尔值、数字或日期时，最好加引号。例如章节标签写成 `chapter: "03"`。
4. 字段名区分大小写，`apiVersion` 不能写成 `apiversion`。
5. 注释从 `#` 开始，不是配置内容。
6. 同一映射中不要重复写相同键，解析器可能只保留后一个值。

“YAML 格式能被解析”不代表“Kubernetes 字段正确”。例如把 `containers` 拼成 `container`，YAML 本身仍然合法，但 Kubernetes API 不接受。后面会使用服务端预检。

### 3.3 不确定字段时，用 explain 查当前集群

```bash
kubectl --context kind-k8s-lab explain pod
kubectl --context kind-k8s-lab explain pod.spec
kubectl --context kind-k8s-lab explain pod.spec.containers
kubectl --context kind-k8s-lab explain pod.spec.containers.securityContext
```

`explain` 根据当前 kubectl 可用的 API schema 展示字段类型和说明。看到：

- `Object`：它下面还有子字段；
- `[]Object`：它是对象列表，YAML 中通常用 `-`；
- `string`、`integer`、`boolean`：它是具体值。

还可以用递归方式浏览字段树：

```bash
kubectl --context kind-k8s-lab explain pod.spec --recursive
```

输出会很长。实际写清单时，应围绕眼前字段逐层查，而不是复制一个庞大模板再删除自己不懂的内容。

## 4. 从零编写第一个 Pod 清单

### 4.1 完整清单

新建 `notes-web-pod.yaml`，写入：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: notes-web
  namespace: k8s-learning
  labels:
    app: notes-app
    component: web
    chapter: "03"
  annotations:
    learning.example.com/purpose: "learn-pod-basics"
spec:
  restartPolicy: Always
  terminationGracePeriodSeconds: 30
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
          protocol: TCP
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

### 4.2 从外到内读懂它

第一层：这是一个 `v1` 版本 API 中的 `Pod`，名字是 `notes-web`，属于 `k8s-learning`。

第二层：labels 用于筛选和建立资源之间的关联，annotations 保存不用于选择的说明信息。标签值 `"03"` 明确作为字符串解析。第四章会系统学习标签、选择器和命名空间。

第三层：`spec.containers` 是容器列表。这里只有一个名为 `web` 的容器，它运行非 root 版 Nginx，监听 8080。

第四层：Pod 级与容器级配置分别承担不同作用：

- `restartPolicy: Always`：容器进程退出后，节点上的 kubelet 会根据策略尝试重启它；这不是 Deployment 创建新 Pod。
- `terminationGracePeriodSeconds: 30`：删除时先给进程优雅退出时间，超时后才强制结束。
- `automountServiceAccountToken: false`：示例应用不访问 Kubernetes API，因此不自动挂载凭据。
- `runAsNonRoot: true`：要求容器不能以 root 身份运行。
- `seccompProfile: RuntimeDefault`：启用运行时提供的默认系统调用过滤配置。
- `allowPrivilegeEscalation: false`：不允许进程通过常见机制提升权限。
- `capabilities.drop: ALL`：移除应用不需要的额外 Linux capabilities。
- `resources`：给调度和运行时一个基础的 CPU、内存边界。

`containerPort` 只是关于容器监听端口的声明，不会自动创建 Service，也不会在电脑上开放端口。后面仍要使用 port-forward 验证。

安全字段并非“复制进去就万事大吉”。它们必须与镜像行为兼容。例如普通 Nginx 镜像通常涉及 root 和 80 端口，而本章选择了明确面向非特权运行的镜像。生产还需要镜像扫描、网络策略、权限隔离、只读文件系统设计等完整措施。

### 4.3 为什么没有写 command

容器镜像本身带有默认 ENTRYPOINT / CMD，因此本章不覆盖它。Kubernetes 中：

- `command` 对应容器镜像的 ENTRYPOINT；
- `args` 对应容器镜像的 CMD。

一旦填写，它们会覆盖镜像默认启动行为。不了解镜像就随意加 `command`，很容易把一个本来能运行的镜像变成 CrashLoopBackOff。故障实验会有意识地使用这一点。

## 5. 提交前先验证，提交后再观察

### 5.1 客户端与服务端预检

先做客户端预检：

```bash
kubectl --context kind-k8s-lab apply --dry-run=client -f notes-web-pod.yaml
```

它在本地处理文件，不真正创建资源，适合快速发现基础问题。然后做服务端预检：

```bash
kubectl --context kind-k8s-lab apply --dry-run=server -f notes-web-pod.yaml
```

服务端预检会把请求发送给 API Server，执行当前集群可用的校验与准入流程，但不持久化对象。因此它需要集群可连接、用户有相应权限，也比单纯 YAML 解析更接近真实提交。

两者都通过仍不保证应用进程一定能启动，例如仓库不可达、镜像命令错误属于后续运行阶段问题。

如果收到类似 `error converting YAML to JSON`，优先查缩进、冒号和列表。若提示 `unknown field` 或 strict decoding error，按字段路径检查拼写，并用 `kubectl explain` 确认。

### 5.2 在改变集群前查看差异

```bash
kubectl --context kind-k8s-lab diff -f notes-web-pod.yaml
```

第一次执行通常会显示将要新增的对象。需要注意：`kubectl diff` 用退出码 `1` 表示“存在差异”，这不是一般意义上的执行故障；退出码大于 1 才表示 kubectl 本身出错。[官方 kubectl diff 说明](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/)

在脚本和 CI 中不能简单地把所有非零退出码都当成同一种失败。手工学习时先读实际差异，确认命名空间、名称、镜像和安全配置正确。

### 5.3 正式提交

```bash
kubectl --context kind-k8s-lab apply -f notes-web-pod.yaml
kubectl --context kind-k8s-lab -n k8s-learning wait --for=condition=Ready pod/notes-web --timeout=180s
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web -o wide
```

期望看到：

```text
NAME        READY   STATUS    RESTARTS   AGE   IP           NODE
notes-web   1/1     Running   0          20s   10.x.x.x     k8s-lab-control-plane
```

逐列理解：

- `NAME`：Pod 对象名称。
- `READY 1/1`：一个容器被判定 Ready，共一个容器。
- `STATUS Running`：kubectl 汇总展示的状态文本。
- `RESTARTS 0`：当前 Pod 中容器被重启的累计次数。
- `AGE`：对象已存在多长时间。
- `IP`：Pod 网络中的地址，不等于稳定服务地址。
- `NODE`：这个 Pod 被调度到的节点。

若没有 Ready，不要继续端口转发，直接进入第 10 节按证据排查。

## 6. 同一个 Pod，为什么能看到多种“状态”

`kubectl get pods` 很方便，但一行表格无法完整表达生命周期。排查时至少要区分四层。

### 6.1 Pod phase：粗粒度生命周期

Pod 的 `.status.phase` 只有少量取值：

| Phase | 大致含义 |
| --- | --- |
| `Pending` | Pod 已被接受，但至少一个容器尚未完成启动准备；可能还没调度，也可能正在拉镜像 |
| `Running` | Pod 已绑定节点，至少一个容器正在运行、启动或重启 |
| `Succeeded` | 所有容器成功结束，并且不会再重启 |
| `Failed` | 所有容器已结束，至少一个失败，且不会再重启 |
| `Unknown` | 无法获得 Pod 状态，常见于节点通信问题 |

```bash
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web -o jsonpath='{.status.phase}{"\n"}'
```

`CrashLoopBackOff` 不是 Pod phase，它是 kubectl 在容器等待状态等信息基础上展示的原因。排查时不要只说“Pod 状态是 CrashLoopBackOff”，应该继续找具体容器状态和退出原因。[官方 Pod 生命周期说明](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)

### 6.2 Container state：某个容器正在做什么

每个容器状态属于以下一种：

- `Waiting`：尚未运行，reason 可能是拉取镜像或退避重启；
- `Running`：容器正在运行，会有启动时间；
- `Terminated`：容器已经结束，会有退出码、原因、起止时间。

查看完整对象中的容器状态：

```bash
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web -o jsonpath='{.status.containerStatuses[0].state}{"\n"}'
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web -o jsonpath='{.status.containerStatuses[0].restartCount}{"\n"}'
```

数组下标 `[0]` 表示第一个容器。多容器 Pod 中不应默认第一个就是目标容器，可以先列出名称：

```bash
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web -o jsonpath='{.spec.containers[*].name}{"\n"}'
```

### 6.3 Conditions：是否满足关键条件

```bash
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web \
  -o custom-columns='TYPE:.status.conditions[*].type,STATUS:.status.conditions[*].status'
```

常见条件包含 Pod 是否已调度、容器是否 Ready、Pod 是否 Ready。一个 Pod phase 为 Running，仍可能因为 readiness 检查失败而 `Ready=False`。本章还没有配置自定义探针，健康检查专题会解释 Kubernetes 如何判断真正可接收流量。

### 6.4 get、describe 和完整 YAML 分别适合什么

```bash
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web
kubectl --context kind-k8s-lab -n k8s-learning describe pod notes-web
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web -o yaml
```

- `get`：快速总览和批量筛选。
- `describe`：把常用配置、状态和相关 Events 组织成人能读的诊断信息。
- `get -o yaml`：查看服务端保存的完整对象，适合定位精确字段和脚本提取。

服务端 YAML 比自己写的文件长很多，会出现 `uid`、`resourceVersion`、`creationTimestamp`、`managedFields`、默认值和 `status`。它是观察结果，不宜整份复制回来替换源清单；很多服务端字段由系统管理，也会制造无意义差异。

记录问题时不要直接公开完整对象。环境变量、注解、卷、镜像仓库和其他元数据可能泄露内部信息；分享前先脱敏，也不要使用 `kubectl get secret -o yaml` 作为普通排查材料。

## 7. 访问应用并读取日志

### 7.1 使用临时端口转发

在终端 A 执行并保持运行：

```bash
kubectl --context kind-k8s-lab -n k8s-learning port-forward pod/notes-web 8080:8080 --address 127.0.0.1
```

浏览器打开 [http://127.0.0.1:8080](http://127.0.0.1:8080)，或在终端 B 执行：

```bash
curl -i http://127.0.0.1:8080/
```

端口占用时改为 `8088:8080`，浏览器地址也要改成 `http://127.0.0.1:8088`。port-forward 只建立本机临时调试通道，不会创建 Service，也不能作为生产流量入口。

### 7.2 读取一次日志

刷新几次页面，然后执行：

```bash
kubectl --context kind-k8s-lab -n k8s-learning logs pod/notes-web -c web --tail=20 --timestamps
```

参数含义：

- `pod/notes-web`：目标 Pod；
- `-c web`：目标容器，多容器 Pod 尤其需要明确；
- `--tail=20`：只取最后 20 行，避免拉回无限历史；
- `--timestamps`：显示每行的时间戳。

容器的标准输出和标准错误是 kubectl logs 的主要来源。应用若只把日志写入容器内某个文件，这条命令看不到；生产中还需要节点级日志采集、保留和检索系统。[官方 kubectl logs 说明](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/)

### 7.3 持续跟随日志

```bash
kubectl --context kind-k8s-lab -n k8s-learning logs pod/notes-web -c web -f --since=5m
```

保持命令运行，再刷新浏览器，会看到新请求日志出现。按 `Ctrl+C` 只结束日志跟随，不会停止 Pod。

如果应用有多个副本或多个容器，生产排查还要结合标签、日志平台和请求标识，不能只盯着恰好选中的一个实例。

## 8. 使用 exec 进入容器排查

### 8.1 exec 不是 SSH

`kubectl exec` 请求 kubelet 在已有容器中启动一个额外进程，并把输入输出连回终端。它不是给 Pod 开启 SSH 服务，也不要求容器运行 sshd。

先执行单个命令：

```bash
kubectl --context kind-k8s-lab -n k8s-learning exec pod/notes-web -c web -- id
```

`--` 把 kubectl 自己的参数和容器内要执行的命令分开。结果中的 UID 不应为 0，这与清单里的非 root 约束相符。

再检查进程和本地监听：

```bash
kubectl --context kind-k8s-lab -n k8s-learning exec pod/notes-web -c web -- ps
kubectl --context kind-k8s-lab -n k8s-learning exec pod/notes-web -c web -- wget -qO- http://127.0.0.1:8080/
```

第二条请求发生在 Pod 内，访问的是同一 Pod 网络空间中的 Nginx。若镜像版本没有 `ps` 或 `wget`，看到 executable not found 不代表应用失败，只说明精简镜像没包含该工具。

### 8.2 交互式 shell

本章镜像基于 Alpine，可以尝试：

```bash
kubectl --context kind-k8s-lab -n k8s-learning exec -it pod/notes-web -c web -- /bin/sh
```

进入后，提示符会变化。只做只读观察：

```sh
id
pwd
cat /etc/os-release
ls -la /usr/share/nginx/html
exit
```

`-i` 保持标准输入，`-t` 分配终端。退出 shell 不会终止原本的 Nginx 进程。

不要把容器内手工安装软件、修改页面或写配置当作发布方式：这些改变没有进入镜像和 YAML，Pod 重建就会丢失，还会造成运行环境与版本库不一致。调试也不应通过 `privileged: true`、挂载宿主机 Docker socket 或长期运行万能工具箱解决。

有些安全设计良好的镜像没有 shell 和诊断工具。这时可以使用 Kubernetes 的临时调试容器等受控能力，但需要单独评估镜像来源、RBAC、审计和对目标 Pod 的影响。[官方调试运行中 Pod 说明](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/)

## 9. 理解 apply：哪些变化能更新，哪些不能

### 9.1 先做一个允许的元数据修改

在 `notes-web-pod.yaml` 的 annotations 下新增一行：

```yaml
    learning.example.com/owner: "your-name"
```

将 `your-name` 换成不敏感的学习标识，不要把邮箱、令牌或生产账号写进公开博客仓库。先看差异再提交：

```bash
kubectl --context kind-k8s-lab diff -f notes-web-pod.yaml
kubectl --context kind-k8s-lab apply -f notes-web-pod.yaml
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web \
  -o jsonpath='{.metadata.annotations.learning\.example\.com/owner}{"\n"}'
```

Pod 不会因为修改这条 annotation 自动重启。元数据变化和容器进程变化不是一回事。

### 9.2 再观察一个不允许的 Pod spec 修改

为了实验，把文件中的：

```yaml
          containerPort: 8080
```

临时改成：

```yaml
          containerPort: 8081
```

然后只执行服务端预检：

```bash
kubectl --context kind-k8s-lab apply --dry-run=server -f notes-web-pod.yaml
```

对于已经存在的 Pod，API Server 应拒绝这种不支持的 spec 更新，并提示 Pod updates may not change fields 一类信息。现在立即把文件改回 `containerPort: 8080`。

即使字段允许提交，`containerPort` 也不会替 Nginx 修改真实监听端口；它是声明信息。真正更改应用监听需要同时设计镜像或启动配置。

Pod 的大部分运行规格不能就地随意改变，因为 Pod 被看作一次具体的调度与运行实例。实际发布通常修改 Deployment 的 Pod 模板，控制器再创建新 Pod 替换旧 Pod。不要为了绕开 API 校验直接修改 etcd 或节点运行时数据。

确认源文件已恢复：

```bash
kubectl --context kind-k8s-lab apply --dry-run=server -f notes-web-pod.yaml
kubectl --context kind-k8s-lab diff -f notes-web-pod.yaml
```

如果只剩服务端默认字段差异或没有输出，再进入下一节。

## 10. 主动制造两类故障并建立证据链

故障实验只在 `k8s-learning` 中创建名称明确的无业务 Pod。每次先制造、观察、解释、清理，再进入下一个，避免多个错误混在一起。

### 10.1 故障一：ImagePullBackOff

新建 `broken-image-pod.yaml`：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: broken-image
  namespace: k8s-learning
  labels:
    chapter: "03"
    exercise: image-pull
spec:
  restartPolicy: Always
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: web
      image: registry.invalid/learning/notes-app:v999
      imagePullPolicy: Always
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 100m
          memory: 64Mi
```

`.invalid` 是为无效域名保留的后缀，适合稳定地产生无法访问的镜像来源，不会把请求发给某个真实陌生仓库。提交并观察：

```bash
kubectl --context kind-k8s-lab apply -f broken-image-pod.yaml
kubectl --context kind-k8s-lab -n k8s-learning get pod broken-image -w
```

看到 `ErrImagePull` 或 `ImagePullBackOff` 后按 `Ctrl+C`，收集证据：

```bash
kubectl --context kind-k8s-lab -n k8s-learning describe pod broken-image
kubectl --context kind-k8s-lab -n k8s-learning get pod broken-image \
  -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}{"\n"}'
kubectl --context kind-k8s-lab -n k8s-learning get events \
  --field-selector involvedObject.name=broken-image \
  --sort-by=.metadata.creationTimestamp
```

证据链应该是：

```text
Pod 不能启动
→ 容器处于 Waiting
→ waiting.reason 是 ErrImagePull / ImagePullBackOff
→ Events 说明镜像地址无法解析或获取
→ 对照 spec 发现镜像名称就是故意写错的
```

这时 `kubectl logs broken-image` 通常没有应用日志，因为容器进程根本没有创建成功。镜像阶段失败，不应该反复排查 Nginx 配置。

实验完成后删除：

```bash
kubectl --context kind-k8s-lab delete -f broken-image-pod.yaml
kubectl --context kind-k8s-lab -n k8s-learning wait \
  --for=delete pod/broken-image --timeout=60s
```

### 10.2 故障二：CrashLoopBackOff

新建 `crash-loop-pod.yaml`：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: crash-loop
  namespace: k8s-learning
  labels:
    chapter: "03"
    exercise: crash-loop
spec:
  restartPolicy: Always
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: nginxinc/nginx-unprivileged:1.28-alpine
      imagePullPolicy: IfNotPresent
      command:
        - /bin/sh
        - -c
      args:
        - 'echo "simulated startup failure"; sleep 2; exit 42'
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 100m
          memory: 64Mi
```

这里故意覆盖镜像默认命令：输出一条日志，等待两秒，以退出码 42 结束。`restartPolicy: Always` 让 kubelet 重启容器；连续失败后，重启间隔逐步退避，于是看到 CrashLoopBackOff。

```bash
kubectl --context kind-k8s-lab apply -f crash-loop-pod.yaml
kubectl --context kind-k8s-lab -n k8s-learning get pod crash-loop -w
```

观察到 RESTARTS 增加后按 `Ctrl+C`，执行：

```bash
kubectl --context kind-k8s-lab -n k8s-learning describe pod crash-loop
kubectl --context kind-k8s-lab -n k8s-learning logs pod/crash-loop -c app --tail=20 --timestamps
kubectl --context kind-k8s-lab -n k8s-learning logs pod/crash-loop -c app --previous --tail=20
kubectl --context kind-k8s-lab -n k8s-learning get pod crash-loop \
  -o jsonpath='{.status.containerStatuses[0].lastState.terminated}{"\n"}'
```

重点寻找：

- 当前容器为什么在 Waiting；
- 上一次容器是否 `Terminated`；
- `exitCode` 是否为 `42`；
- `restartCount` 是否增加；
- 当前或 `--previous` 日志是否出现 `simulated startup failure`。

这次镜像已经能启动容器，所以有应用日志。CrashLoopBackOff 不是根因，而是“失败—重启—再次失败”后的退避表现；根因是我们覆盖了启动命令并主动退出。

完成后删除：

```bash
kubectl --context kind-k8s-lab delete -f crash-loop-pod.yaml
kubectl --context kind-k8s-lab -n k8s-learning wait \
  --for=delete pod/crash-loop --timeout=60s
```

### 10.3 一套可以复用的排查顺序

遇到 Pod 异常时，先走以下顺序：

```text
1. 范围：context、namespace、资源名对不对？
2. 概览：get pods 看 READY、STATUS、RESTARTS、AGE、NODE。
3. 详情：describe 看容器 state、reason、last state 和底部 Events。
4. 事件：判断调度、镜像、网络、卷、探针或权限失败。
5. 日志：容器确实启动过，再看当前日志和 --previous。
6. 容器内：进程仍可运行且有必要时，再 exec 做最小化只读检查。
7. 配置：对照 YAML、镜像和实际状态，修改声明后重新验证。
```

这不是绝对死板的顺序，但能防止最常见的无效动作：容器都没创建就找应用日志，镜像拉取失败却进入容器，或连接错集群仍不断重建资源。[官方 Pod 调试指南](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/)

## 11. 删除 notes-web：观察没有控制器时会发生什么

先记录 Pod 身份：

```bash
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web \
  -o custom-columns='NAME:.metadata.name,UID:.metadata.uid,NODE:.spec.nodeName,IP:.status.podIP'
```

如果 port-forward 或日志跟随仍在运行，先按 `Ctrl+C` 停止它们。然后删除：

```bash
kubectl --context kind-k8s-lab delete -f notes-web-pod.yaml
kubectl --context kind-k8s-lab -n k8s-learning wait \
  --for=delete pod/notes-web --timeout=60s
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web
```

最后一条应返回 NotFound。等待片刻也不会有新的 `notes-web`，因为本章没有 Deployment、ReplicaSet 或其他控制器声明“这里应该始终有一个副本”。

重新提交：

```bash
kubectl --context kind-k8s-lab apply -f notes-web-pod.yaml
kubectl --context kind-k8s-lab -n k8s-learning wait \
  --for=condition=Ready pod/notes-web --timeout=180s
kubectl --context kind-k8s-lab -n k8s-learning get pod notes-web \
  -o custom-columns='NAME:.metadata.name,UID:.metadata.uid,NODE:.spec.nodeName,IP:.status.podIP'
```

名称仍是 `notes-web`，但 UID 一定是新的，IP 也可能变化。Kubernetes 资源由“类型 + 命名空间 + 名称”供人定位，但每次创建的对象实例还有不可重复使用的 UID。

与第二章删除 Deployment 管理的 Pod 对照：

- 第二章：删除的是控制器管理的实例，副本期望仍在，所以自动创建替代 Pod；
- 本章：删除的是唯一 Pod 对象，没有更高层副本期望，所以不会自动回来；
- 本章重新出现：是你再次 apply 文件创建的，不是自愈自动完成的。

这一实验也解释了为什么生产无状态服务通常交给 Deployment 管理。Pod 是运行单元，Deployment 才负责持续维护副本和发布版本。

## 12. 常见误区与命令速查

### 12.1 七个常见误区

1. **Pod 等于容器**：Pod 是 Kubernetes 对象，可以包含多个容器以及共享网络、卷和生命周期配置。
2. **Running 等于业务正常**：它是粗粒度阶段，仍需结合 Ready、探针、日志和实际请求。
3. **containerPort 等于对外开放端口**：它不会自动创建宿主机映射、Service 或 Ingress。
4. **CrashLoopBackOff 就是根因**：它只是反复崩溃后的退避表现，要找退出码和日志。
5. **所有故障都看 logs**：镜像尚未拉取时没有应用进程，自然没有应用日志。
6. **exec 进去修好就算发布成功**：手工修改不可复现，Pod 重建会丢失。
7. **删除 Pod 都会自动恢复**：只有更高层控制器的期望仍存在时，才会创建替代实例。

### 12.2 本章命令速查

```bash
# 先确认操作范围
kubectl config current-context
kubectl --context kind-k8s-lab get namespace k8s-learning

# 字段帮助与预检
kubectl --context kind-k8s-lab explain pod.spec.containers
kubectl --context kind-k8s-lab apply --dry-run=server -f notes-web-pod.yaml
kubectl --context kind-k8s-lab diff -f notes-web-pod.yaml

# 创建与查看
kubectl --context kind-k8s-lab apply -f notes-web-pod.yaml
kubectl --context kind-k8s-lab -n k8s-learning get pods -o wide
kubectl --context kind-k8s-lab -n k8s-learning describe pod notes-web

# 日志与容器内命令
kubectl --context kind-k8s-lab -n k8s-learning logs pod/notes-web -c web --tail=50
kubectl --context kind-k8s-lab -n k8s-learning logs pod/notes-web -c web --previous
kubectl --context kind-k8s-lab -n k8s-learning exec pod/notes-web -c web -- id

# 只看本章实验资源
kubectl --context kind-k8s-lab -n k8s-learning get pods -l chapter=03
kubectl --context kind-k8s-lab -n k8s-learning get events \
  --sort-by=.metadata.creationTimestamp
```

`logs --previous` 只有容器发生过重启且上一实例日志仍可用时才有结果。Events 也有保留期限，因此排查时及时收集证据，不要把它们当永久记录。

## 13. 清理、验收与复盘

### 13.1 清理故障资源，保留主实验

先列出本章带标签的 Pod：

```bash
kubectl --context kind-k8s-lab -n k8s-learning get pods -l chapter=03
```

正常结束时应只有 `notes-web`。如果故障 Pod 仍存在，用明确名称删除：

```bash
kubectl --context kind-k8s-lab -n k8s-learning delete pod broken-image crash-loop --ignore-not-found
```

建议保留 `notes-web` 和 `notes-web-pod.yaml` 进入第四章，继续练习标签和选择器。如果想从干净的应用环境开始，可只删除主 Pod：

```bash
kubectl --context kind-k8s-lab delete -f notes-web-pod.yaml
```

不要删除 `k8s-learning` 命名空间，除非确认里面所有章节资源都可丢弃。也不需要清空整个集群、执行 Docker 全局 prune 或删除 kubeconfig。

### 13.2 实操验收清单

- [ ] 能指出 Pod YAML 中的 `apiVersion`、`kind`、`metadata` 和 `spec`。
- [ ] 能使用 `kubectl explain` 查询一个不熟悉的字段。
- [ ] 能解释为什么客户端预检通过后，Pod 仍可能启动失败。
- [ ] 能区分 Pod phase、容器 state、Conditions 和 kubectl STATUS。
- [ ] 能通过 port-forward 访问 `notes-web`，并在日志中找到请求。
- [ ] 能执行容器内的 `id`，解释 `--` 和 `-c web` 的作用。
- [ ] 能通过 Events 定位故意制造的镜像拉取失败。
- [ ] 能通过 `--previous`、lastState 和退出码解释 CrashLoopBackOff。
- [ ] 能解释为什么裸 Pod 被删除后不会自动恢复。
- [ ] 所有故障实验资源已清理，主 Pod 是否保留已有明确记录。

### 13.3 不看文章回答十个问题

1. Pod 为什么不是容器的另一个名字？
2. `spec` 和 `status` 分别由谁表达什么？
3. YAML 解析成功为什么不等于 Kubernetes 一定接受？
4. `1/1 Running` 中两部分各自说明什么，不能说明什么？
5. Pending 为什么不一定表示调度失败？
6. ImagePullBackOff 时为什么常常没有应用日志？
7. CrashLoopBackOff 应该继续寻找哪三类证据？
8. 为什么不建议通过 exec 手工修改线上应用？
9. 名字相同但 UID 不同，说明发生了什么？
10. kubelet 重启容器与 Deployment 创建新 Pod 有什么差别？

<details>
<summary>展开参考答案</summary>

1. Pod 是 Kubernetes 的调度和运行单元，包含元数据、共享网络、可选卷以及一个或多个容器。
2. spec 表达用户期望配置；status 是系统观察和维护的实际状态。
3. YAML 解析只验证数据格式，字段 schema、准入规则、权限和运行条件还要由 Kubernetes 与实际环境判断。
4. `1/1` 表示一个容器被判定 Ready，共一个；Running 是粗粒度阶段。它们不等于业务所有功能、流量入口和高可用都已验证。
5. Pending 表示尚未完成启动准备，可能处于调度、拉镜像、挂载或其他准备环节。
6. 镜像没有拉取成功时，容器进程尚未创建，自然没有该进程输出的日志。
7. 查当前/上一次容器状态与退出码、当前/previous 日志、相关 Events 和实际启动配置。
8. 手工修改不在镜像和声明中，无法审计、复现或可靠恢复，Pod 重建后还会丢失。
9. 原对象已删除，后来创建了一个新的对象实例；名称可以复用，UID 不复用。
10. kubelet 在同一 Pod 沙箱中按 restartPolicy 重启容器；Deployment 控制器通过 ReplicaSet 维护副本，必要时创建新的 Pod 对象。

</details>

### 13.4 建议留下的实验记录

```text
实验日期：
集群、context、namespace：
notes-web 第一次创建时的 UID、IP、节点：
重新创建后的 UID、IP、节点：
镜像拉取失败的 waiting.reason 与关键 Event：
CrashLoopBackOff 的 exitCode、restartCount 与 previous 日志：
哪些 kubectl 输出最先帮助我定位问题：
我是否进入容器做过修改，这些修改能否复现：
本章保留和删除了哪些资源：
用自己的话解释：Pod、容器、Deployment 三者是什么关系？
```

## 官方资料与下一章

- [Kubernetes：Pod](https://kubernetes.io/docs/concepts/workloads/pods/)
- [Kubernetes：Pod 生命周期](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Kubernetes：理解 Kubernetes 对象](https://kubernetes.io/docs/concepts/overview/working-with-objects/)
- [Kubernetes：调试 Pod](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/)
- [kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/)
- [kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/)
- [kubectl exec](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_exec/)

下一章《标签、选择器、命名空间与资源管理》会继续使用本章的 `chapter: "03"`、`app: notes-app` 和 `component: web`，学习怎样准确筛选一组资源、理解选择器，以及为学习环境建立更清晰的资源边界。

[上一章：使用 kind 创建本地集群](/k8s-02-kind-cluster/) · [返回《K8s学习记录》系列目录](/k8s-learning-notes/)
