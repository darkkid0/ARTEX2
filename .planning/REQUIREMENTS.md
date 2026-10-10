# Requirements: ARTEX — AI 拒止与记录污染治理

**Defined:** 2026-10-10
**Core Value:** 在授权范围内，agent 全程正常执行任务，拒止声明不再进入探索图、不再传染后续规划，且污染一旦发生操作员可在代码层面精确清除/修正/审计。

**需求唯一来源:** `docs/拒止污染治理方案.md`（二审定稿，Q1–Q15 拍板）+ 研究补充（标 ★ 条目，来自 `.planning/research/PITFALLS.md` / `ARCHITECTURE.md`）。

## v1 Requirements

### 纪律提示词（方案 A + H 第一层 + I）

- [ ] **DISC-01**: 8 个 agent（worker/pentest/planner/mainagent/auto/goals/reporter/retester）默认提示词含「授权与执行纪律」段：授权范围内必须执行、不得以道德/合规为由拒绝、禁止把拒绝决定写成事实或漏洞；★ 防编造逃生阀句（真实不可达时如实报告而非伪造结果）与纪律段同 commit 上线
- [ ] **DISC-02**: planner 纪律段含三出口规则：每轮要么产出意图、要么按正当理由说明（已覆盖/等待依赖）、要么 prove_goal 判定达成；三出口之外无合法出口
- [ ] **DISC-03**: 全部纪律段声明优先级仲裁：deny 类操作约束 > 授权凭据 > 默认执行纪律；"已授权"不得用于越过 deny 约束
- [ ] **DISC-04**: 存量库 reseed 全覆盖：6 个内置 agent 各自 settings flag（pentest/auto 新增 reseed 函数），reporter 走 upgradeReporterTriggerMessage 式一次性迁移，retester 并入 seedFindingRetester 的 advisory lock 内；用户改过的提示词不被覆盖
- [ ] **DISC-05**: 提示词历史版本保留可一键切回；迁移 flag 幂等（重跑不重复追加）

### facts 治理（方案 C）

- [ ] **GRAPH-01**: 操作员可硬删除本任务的 fact：DELETE /api/exploration/facts/{id}，UI 带确认对话框，SQL 一律带 kind='fact' 锁定
- [ ] **GRAPH-02**: 操作员可将 fact 置 dismissed（软失效）：PATCH state，节点保留可追溯，UI 降透明度/删除线渲染
- [ ] **GRAPH-03**: 操作员可修改 fact 的 summary/detail：UpdateFactPayload 必须在 UPDATE 中 bump content_version（不得照抄不 bump 的 UpdateGoalPayload）
- [ ] **GRAPH-04**: dismissed fact 对模型侧全部读路径隐藏：本任务列表、source 合并页（含 total/hasMore 计数）、relatedTaskOverviews 继承、cold-digest 折叠、graph_overview 直读（facts_total 与 recent_facts）、GetNode 单点读取（返回"已否定"占位）；★ 过滤必须 SQL 内完成（post-fetch 过滤会漏计数）
- [ ] **GRAPH-05**: dismissed fact 不经旁路泄漏：★ q= ILIKE 搜索、★ ListByKind(N) 窗口失真、血缘边/历史对话回读；agent 侧工具结构上无法传 include_dismissed
- [ ] **GRAPH-06**: UI：探索图 NodeDetailSheet 为 fact 节点加「作废/删除/编辑」按钮；graph-tab 加「显示已否定」开关（include_dismissed=true 仅 UI 显式传）+ 管理操作后就地重拉
- [ ] **GRAPH-07**: 治理操作写独立审计表 governance_log（范式照 finding_cases，不随归档消失）+ activity 双写（Worker='system'）供活动流即时展示；governance_log 接入归档快照表数组与恢复循环
- [ ] **GRAPH-08**: 继承/关联任务的 fact 只读：跨任务 id 调删除/修改返回 404
- [ ] **GRAPH-09**: 硬删后旧 activity 行经 ON DELETE SET NULL 保留文本、置空 node_id，UI 有兜底文案

### 写入侧处置（方案 D/L）

- [ ] **WRITE-01**: record_fact 首次命中自指关键词集 → 降级写入（confidence→inferred + payload note 标记），模型收到降级提示
- [ ] **WRITE-02**: 同一次工具调用的本批 items 内连续 2 次命中 → 升级为报错强制重写（单条报错不整批失败）
- [ ] **WRITE-03**: 关键词集为自指模式（拒绝执行/不予执行/道德考量/出于合规/refuse to…），禁用裸"拒绝"："connection refused/403 拒绝访问/请求被拒绝"类真实否定观察不触发拦截或降级；"道德/伦理"只收复合词
- [ ] **WRITE-04**: prove_goal 拒绝把拒止声明类 fact 用作达成证明 evidence（复用同一关键词集校验）
- [ ] **WRITE-05**: 关键词判定抽成共用 helper，D/L 与 prove_goal 同源

### planner 硬防线（方案 H 第二层 + K + 第三层）

- [ ] **PLAN-01**: WriteCounts 增加 Intents 字段并在 addOneIntent 递增；Plan() 返回扩展为携带本轮新产 intent 数（不得用 engine 侧 HasActiveIntent 代替）
- [ ] **PLAN-02**: 拒止分流器：本轮 0 新产 intent + GoalMet=false + 存在未达成目标 + frontier/running 均空 → 追加纠偏 user 消息重跑本轮（ExecuteWithMessage 既有路径），仅重试一次；空轮不写图，只记 activity
- [ ] **PLAN-03**: 连败计数：相邻拒止轮累加、纠偏成功清零、重试后仍空轮计入；任务重启后从 activity 流回溯恢复基数
- [ ] **PLAN-04**: K 分类器：ClassifyPlannerRound 三态 verdict（refusal/normal/★ assess_failed），★ 原始输出留痕，仅在"0 新产 intent + frontier/running 均空"疑似场景触发，任务级节流（默认 10 分钟，settings 可配），模型不可用按 llm_judge_fail_action 放行（宁漏勿错）；复用 judge 基建（provider/verdict 解析/llmrec 台账/失败策略），不复用 intercept 规则表
- [ ] **PLAN-05**: 正常空轮（已覆盖/等待依赖）不触发纠偏重试
- [ ] **PLAN-06**: H 第三层：连败 N=3（可配）自动挂 hint 系统托管声明；再连败 M=2（可配）在活动流发显式告警提示操作员介入；复用 hint/activity/notify 既有通道
- [ ] **PLAN-07**: ★ 任务级降级 fact 监控：单任务降级写入率异常（阈值可配）时活动流告警，防"降级优先把事实污染转化为 intent 污染"的 frontier 洪泛

### 授权凭据（方案 J）

- [ ] **AUTH-01**: task_authorizations 独立表（authorizer/valid_until/scope/action_level，范式照 task_constraints），接入归档快照表数组与恢复循环；不用 tasks 行内 JSON 列
- [ ] **AUTH-02**: get_authorization 只读工具（照 readExpTool 写法），默认绑定 worker/planner/pentest/mainagent，返回凭据 JSON + "授权行为"一句话
- [ ] **AUTH-03**: guard 审查上下文携带任务授权凭据（ReviewBackground 扩展或 Authorization 附件字段，牵动 BuildReviewInput 与其测试）；★ deny 规则先于 LLM 裁判判定，防凭据在裁判语境下权重凌驾 deny 红线
- [ ] **AUTH-04**: 有效期 fail-safe：valid_until 过期后 guard 对利用类动作转 deny（或 ask，settings 二选一，默认 deny）；过期前后各一条 activity 提醒；★ 含任务中途过期的过渡验收（planner 不因静默 deny 墙无限空转）
- [ ] **AUTH-05**: 凭据不减损 deny 约束：guard 判定序 + 提示词纪律段双声明（与 DISC-03 同源）

### 任务模板（方案 M）

- [ ] **TPL-01**: 3–5 个场景模板常量表（Web 渗透/内网横向/API 测试/复测验证）+ UI 新建任务一键填充：描述 + 授权凭据初值（同步方案 J 字段）+ 成对 allow/deny 约束集（走 set_constraints）
- [ ] **TPL-02**: README「任务创建」节附模板全文 + 「任务描述怎么写」小节

### 净房重跑（方案 E）

- [ ] **RERUN-01**: rerunIntent 支持 fresh=true：复用原意图文本新建 intent 节点（derived_from 血缘指向旧 intent），新会话不加载旧 transcript
- [ ] **RERUN-02**: 终态旧 intent 处置：走 cancel 路径或"置 blocked_reason 并跳过领取"——Frontier/ClaimIntent 新增 blocked_reason 过滤（不硬删 transcript，不用 SoftDeleteIntent 处理终态）
- [ ] **RERUN-03**: UI rerun 交互加净房模式勾选

### 度量与文档（方案 N + F + B）

- [ ] **METRIC-01**: 拒止基线审计 job：scheduler watermark 模式（status IN ('done','timeout') 触发，一任务一次），按入库原样统计（直查 DB 不看 dismissed 过滤，dismissed 仅作维度列出）；分子分母含拒止 facts 数/facts 总数、降级标记条目、planner 空轮 refusal 轮次占比
- [ ] **METRIC-02**: 审计结果落独立表（不随归档消失）+ 只读 API + 任务详情「拒止审计」卡片；清单条目一键跳转方案 C 的作废/删除（审计→治理闭环）；★ PLAN-07 的降级率监控数据与 METRIC-01 同源
- [ ] **METRIC-03**: README「拒止/误拦排查」小节（方案 F）：覆盖 worker 拒止与 planner 空轮两种形态；引用的处置入口（拦截审批页、LLM 兜底裁判配置、审批记录）真实可达

## v2 Requirements

（无 —— 一期与二期方案全部纳入 v1。研究识别的非阻塞增强留作后续里程碑候选：关键词集在线调参免重启、跨任务拒止趋势视图、批量勾选作废。）

## Out of Scope

| Feature | Reason |
|---------|--------|
| findings 的"已否定"入口 | 现有 PATCH /api/exploration/findings/{id} 已可否认漏洞，不重复建设（Q5） |
| 批量勾选作废 facts | 首期靠 kind/q 过滤 + 人工辨认（Q2/5.3） |
| worker/agent 侧删除/改写 facts 的工具 | 给模型开历史改写能力引入新污染风险，删改只走 API+UI 人操作（5.1 约束 5） |
| tasks 行内 JSON 列承载授权凭据 | 避开 json_populate_record 整行 UPDATE 的 schema 漂移（12.2.1） |
| UI 手工改提示词作为治理手段 | 本项目目标即代码层面的长久治理（文档范围声明） |
| 用户可编辑的关键词集 | 误伤调优需改代码重发版（研究识别的 gap，刻意接受：防运行时被篡改成绕过通道） |
| 自动 dismiss 自动化 | 治理动作必须人工确认，防自动清理吞掉真实观察 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DISC-01 | Phase 1 | Pending |
| DISC-02 | Phase 1 | Pending |
| DISC-03 | Phase 1 | Pending |
| DISC-04 | Phase 1 | Pending |
| DISC-05 | Phase 1 | Pending |
| GRAPH-01 | Phase 2 | Pending |
| GRAPH-02 | Phase 2 | Pending |
| GRAPH-03 | Phase 2 | Pending |
| GRAPH-04 | Phase 2 | Pending |
| GRAPH-05 | Phase 2 | Pending |
| GRAPH-06 | Phase 2 | Pending |
| GRAPH-07 | Phase 2 | Pending |
| GRAPH-08 | Phase 2 | Pending |
| GRAPH-09 | Phase 2 | Pending |
| WRITE-01 | Phase 2 | Pending |
| WRITE-02 | Phase 2 | Pending |
| WRITE-03 | Phase 2 | Pending |
| WRITE-04 | Phase 2 | Pending |
| WRITE-05 | Phase 2 | Pending |
| PLAN-01 | Phase 3 | Pending |
| PLAN-02 | Phase 3 | Pending |
| PLAN-03 | Phase 3 | Pending |
| PLAN-04 | Phase 3 | Pending |
| PLAN-05 | Phase 3 | Pending |
| PLAN-06 | Phase 6 | Pending |
| PLAN-07 | Phase 5 | Pending |
| AUTH-01 | Phase 4 | Pending |
| AUTH-02 | Phase 4 | Pending |
| AUTH-03 | Phase 4 | Pending |
| AUTH-04 | Phase 4 | Pending |
| AUTH-05 | Phase 4 | Pending |
| TPL-01 | Phase 4 | Pending |
| TPL-02 | Phase 4 | Pending |
| RERUN-01 | Phase 6 | Pending |
| RERUN-02 | Phase 6 | Pending |
| RERUN-03 | Phase 6 | Pending |
| METRIC-01 | Phase 5 | Pending |
| METRIC-02 | Phase 5 | Pending |
| METRIC-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 39 total
- Mapped to phases: 39
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-10*
*Last updated: 2026-10-10 after initial definition*
