# Roadmap: ARTEX — AI 拒止与记录污染治理

## Overview

本里程碑在既有 ARTEX 平台（Go 1.26 单二进制 + Next.js 16 静态导出 + PostgreSQL）上落地「AI 拒止与记录污染」的代码级长久治理。路径遵循设计文档（`docs/拒止污染治理方案.md`）§17/§20 的分层防御批次：先从源头劝阻（8 个 agent 的提示词纪律 + 存量库 reseed 迁移），再治理存量与写入侧（facts 删除/作废/修改、dismissed 全路径 SQL 内隐藏、D/L 降级拒收、governance_log 审计），然后建立 planner 行为级硬防线（WriteCounts.Intents + 拒止分流器 + 三态裁判），补齐授权凭据一等公民与任务模板，最后用拒止免疫情度量闭环收尾并交付净房重跑与升级托管。每个阶段交付一个端到端、操作员可观测的治理能力（DB→API→UI→验收在阶段内闭环）。研究识别的 8 条文档外验收红线（防编造逃生阀同 commit、归档 round-trip harness 先行、In-SQL 过滤门、三态裁判、过期过渡测试、WriteCounts 前置、关键词 helper+kill-switch 同 commit、frontier 洪泛监控）已逐条转化为所属阶段的成功标准。

**需求唯一来源**：`docs/拒止污染治理方案.md`（二审定稿，Q1–Q15 拍板）。
**Mode**：mvp（每个阶段交付端到端用户可见的治理能力，不做水平分层）。

## Phases

- [ ] **Phase 1: 提示词纪律与迁移 (Prompt Discipline & Reseed)** - 8 个 agent 统一「授权与执行纪律」段 + 存量库 reseed 全覆盖，源头劝阻拒止落图
- [ ] **Phase 2: 图谱治理 (Graph Governance)** - facts 作废/删除/编辑 + dismissed 模型侧全路径 SQL 内隐藏 + D/L 写入侧降级拒收 + governance_log 独立审计
- [ ] **Phase 3: planner 硬防线 (Planner Hard-Line)** - WriteCounts.Intents + 拒止分流纠偏重试 + 三态裁判分类器（H-L2 + K 同批）
- [ ] **Phase 4: 授权凭据与任务模板 (Authorization & Templates)** - task_authorizations 独立表 + get_authorization 工具 + guard 过期 fail-safe + 模板一键填充（J + M）
- [ ] **Phase 5: 度量与文档收尾 (Measurement & Docs)** - 拒止免疫审计报表 + 降级/复检意图监控 + README 排查与授权文档（N + F + B + PLAN-07）
- [ ] **Phase 6: 净房重跑与升级托管 (Clean-Room Rerun & Escalation Custody)** - 被拒意图净房重跑（方案 E）+ 连败升级托管（H-L3），v1 收口

## Phase Details

### Phase 1: 提示词纪律与迁移 (Prompt Discipline & Reseed)
**Goal**: 全部 8 个 agent（worker/pentest/planner/mainagent/auto/goals/reporter/retester）携带统一的「授权与执行纪律」段，使授权范围内 agent 正常执行、拒止声明不再写成事实；存量库无 UI 升级即完成迁移且不覆盖用户自改提示词。
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04, DISC-05
**Success Criteria** (what must be TRUE):
  1. 存量库升级后（不动任何 UI），worker/pentest/planner/mainagent/auto/goals 六个内置 agent 的系统提示含「授权与执行纪律」段，reporter/retester 完成一次性迁移刷新（agent_prompts 当前版本可见）；pentest/auto 新增 reseed 函数，retester 刷新并入 seedFindingRetester 的 advisory lock；历史版本保留可一键切回，迁移 flag 幂等（重跑不重复追加），用户改过的提示词不被覆盖（§19-5，DISC-04/05）
  2. 用含明确授权的描述创建一个新任务：worker 全程无以道德/合规为由的拒止，拒止声明不落探索图（§19-1，DISC-01）
  3. 对一个故意打不通（broken）的目标运行任务：以如实的失败/无法定论记录收尾，图中零伪造成功，retester 不在没有重新触发 PoC 的情况下报 reproduced —— 防编造逃生阀句与纪律段在同一 commit 上线（研究 Pitfall #1 验收红线）
  4. planner 纪律段含三出口规则（产出意图 / 正当理由说明 / prove_goal 达成，三出口之外无合法出口），且全部纪律段声明优先级仲裁：deny 约束 > 授权凭据 > 执行纪律，「已授权」不得越过 deny 约束（DISC-02/03）
**Plans**: TBD

### Phase 2: 图谱治理 (Graph Governance)
**Goal**: 操作员可在代码层面精确清除/修正/审计污染（fact 作废/删除/编辑），被否定内容对模型侧全部读路径不可见，新写入的拒止声明在写入侧被降级或拒收——所有治理动作落独立审计表并跨归档存活。
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04, GRAPH-05, GRAPH-06, GRAPH-07, GRAPH-08, GRAPH-09, WRITE-01, WRITE-02, WRITE-03, WRITE-04, WRITE-05
**Success Criteria** (what must be TRUE):
  1. 操作员在 NodeDetailSheet 对 fact 执行作废/删除/编辑：DELETE 后模型侧 list_facts 与探索图立即查不到；PATCH dismissed 后模型侧全路径不可见——本任务列表、source 合并页（含 total/hasMore 计数）、relatedTaskOverviews 继承、cold-digest 折叠、graph_overview（facts_total 与 recent_facts）、GetNode 单点读取返回「已否定」占位、q= ILIKE 搜索、关联任务读图（任务 A dismissed，关联任务 B 的 planner 不可见）；过滤全部在 SQL 内完成（无任何 post-fetch 过滤），UI 切「显示已否定」（include_dismissed 仅 UI 显式传）可见原文且管理操作后就地重拉；agent 侧工具结构上无法传 include_dismissed（§19-2/14，GRAPH-01..06，研究 Pitfall #6 In-SQL 过滤门）
  2. 修改 fact summary 后，下一轮 planner 唤醒的 graph_overview 态势蒸馏即反映新文案——UpdateFactPayload 在同一 UPDATE 中 bump content_version（不得照抄不 bump 的 UpdateGoalPayload）（§19-3，GRAPH-03）
  3. 关键词治理（自指模式、禁用裸「拒绝」）：构造「我拒绝执行/出于合规不予执行」类 summary 首次命中被降级写入（confidence→inferred + note，模型收到降级提示），同批 items 第二次命中返回报错强制重写（单条报错不整批失败）；「connection refused/403 拒绝访问」类真实否定观察不触发拦截或降级；prove_goal 拒绝把拒止声明类 fact 用作达成 evidence；共用关键词 helper、kill-switch 开关与首个消费方同 commit 上线（§19-2b/10，WRITE-01..05，研究 Pitfall #8）
  4. 治理审计与边界：删除/dismiss 后 governance_log 有对应记录且 activity 双写（Worker='system'）；任务归档再恢复后记录仍在；继承/关联任务的 fact 调删除/修改返回 404；硬删后旧 activity 行文本保留、node_id 置空有兜底文案；表驱动归档/恢复 round-trip 测试 harness 在建 governance_log 之前落地并同 commit 扩展（§19-2a/4，GRAPH-07..09，研究 Pitfall #2 harness 先行红线）
**Plans**: TBD

### Phase 3: planner 硬防线 (Planner Hard-Line)
**Goal**: planner 的拒止空轮被确定性判定并在轮内纠偏重试，配以带节流的三态裁判兜底——提示词软约束之外建立代码级行为硬防线，正常空轮绝不误伤。
**Mode:** mvp
**Depends on**: Phase 2 (同一 agent/tools.go 文件错峰；复用 Phase 2 落地的批内计数语义)
**Requirements**: PLAN-01, PLAN-02, PLAN-03, PLAN-04, PLAN-05
**Success Criteria** (what must be TRUE):
  1. WriteCounts.Intents 先行落地并在 addOneIntent 递增，Plan() 返回携带本轮新产 intent 数（不用 engine 侧 HasActiveIntent 代替）——分流器 PR 在此计数合入前不得 proceed（研究 Pitfall #7 前置红线，PLAN-01）
  2. 构造敏感类目标使 planner 连续空轮：满足判定（0 新产 intent + GoalMet=false + 存在未达成目标 + frontier/running 均空）的首个拒止轮内自动追加纠偏 user 消息重试一次（ExecuteWithMessage 既有路径），重试后产出意图，活动流可见「拒止 + 纠偏后成功」两条记录；空轮不写图，只记 activity（§19-6，PLAN-02）
  3. 正常空轮（已覆盖/等待依赖，frontier 或 running 非空）不触发纠偏重试（§19-8，PLAN-05）
  4. ClassifyPlannerRound 三态 verdict（refusal/normal/assess_failed）+ 原始输出留痕：仅「0 新产 intent + frontier/running 均空」疑似场景触发；normal 判决放行不重试；模型不可用按 llm_judge_fail_action 放行（宁漏勿错），解析/基建失败绝不静默判 normal；任务级节流窗口内重复疑似空轮不再调用模型（activity 可见「分类器节流中」）；连败计数相邻拒止轮累加、纠偏成功清零，任务重启后从 activity 流回溯恢复基数（§19-11，PLAN-03/04，研究 Pitfall #6 三态裁判红线；复用 judge 基建，不触碰 intercept 规则表）
**Plans**: TBD
**Notes**: 计划期建议走 `/gsd-plan-phase --research-phase`：Plan() 签名涟漪需 call-site 清单；ExecuteWithMessage 转写持久化语义（Pitfall 10）须先对 norma 行为验证。

### Phase 4: 授权凭据与任务模板 (Authorization & Templates)
**Goal**: 授权从任务描述文本升级为一等公民凭据：独立表承载、agent 可查、guard 审查可见且永不减损 deny 红线、过期 fail-safe 可见；操作员用模板一键创建约束完备的合规任务。
**Mode:** mvp
**Depends on**: Phase 1 (提示词补句 riding reseeded 纪律段，无第二次 reseed), Phase 2 (扩展其归档 round-trip harness 接入第三张表)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, TPL-01, TPL-02
**Success Criteria** (what must be TRUE):
  1. 授权有效期内 get_authorization 返回凭据 JSON + 「授权行为」一句话（默认绑定 worker/planner/pentest/mainagent，照 readExpTool 写法）；task_authorizations 独立表（authorizer/valid_until/scope/action_level，范式照 task_constraints，不用 tasks 行内 JSON 列）接入归档快照与恢复循环，round-trip harness 同 commit 扩展，恢复后过期凭据仍可见地 deny（§19-9 前半，AUTH-01/02，研究 Pitfall #2）
  2. 任务中途跨过 valid_until 的过渡验收（不可协商）：在途任务 guard 对利用类动作即时转 deny（或 settings 配置的 ask），planner 不因静默 deny 墙无限空转；过期前后各一条 activity 提醒（「授权即将过期」/「授权已过期，动作被拒」）（§19-9，AUTH-04，研究 Pitfall #5 过期过渡红线）
  3. deny 规则在 LLM 裁判判定之前生效，凭据不得在裁判语境下凌驾 deny 红线；裁判提示词含优先级句（deny > 凭据），guard ReviewBackground 扩展同批更新锁定测试且不放宽 user_message-only 来源门；与 DISC-03 同源声明「凭据不减损 deny 约束」（AUTH-03/05）
  4. 新建任务选择「Web 渗透」模板后：描述、授权凭据初值（同步 J 字段）、成对 allow/deny 约束集一次填充到位，goals 抽取后 set_constraints 落库；README「任务创建」节附模板全文与「任务描述怎么写」指引（§19-12，TPL-01/02）
**Plans**: TBD

### Phase 5: 度量与文档收尾 (Measurement & Docs)
**Goal**: 前 4 层治理全部变得可度量：拒止免疫的原始 DB 数据面产出基线报表并可一键跳转治理动作，降级写入率/复检意图率监控闭合 frontier 洪泛风险，操作文档的每个处置入口真实可达。
**Mode:** mvp
**Depends on**: Phase 1, Phase 2, Phase 3, Phase 4 (度量层 1–4 的标记：降级 note、分流 activity、assess_failed verdict、governance_log 维度)
**Requirements**: METRIC-01, METRIC-02, METRIC-03, PLAN-07
**Success Criteria** (what must be TRUE):
  1. 构造含拒止 facts 的任务结束后，审计 job（scheduler watermark 模式，status IN ('done','timeout') 触发，一任务一次）产出非零拒止率；任务详情「拒止审计」卡片可展开清单，条目一键跳转方案 C 的作废/删除（审计→治理闭环）（§19-13，METRIC-01/02）
  2. 人工 dismiss 掉部分记录后报表分子不缩水（直查 DB 原样统计，dismissed 仅作维度列出）；assess_failed 轮次占比、降级写入条目数、recheck-intent 率作为一等指标出现在报表中（§19-13，研究 Pitfall #3 洪泛观测红线）
  3. 单任务降级写入率超阈值（可配）时活动流告警（PLAN-07，与 METRIC-01 同数据源，防「降级把事实污染转化为 intent 污染」）；审计结果落独立表 UNIQUE(task_id) upsert 修订追加，watermark 同事务推进，不随归档消失（PLAN-07，METRIC-02）
  4. README「拒止/误拦排查」小节覆盖 worker 拒止与 planner 空轮两种形态，引用的处置入口（拦截审批页、LLM 兜底裁判配置、审批记录）真实可达；README「任务创建」授权描述模板与操作规程就位（§19-15，METRIC-03）
**Plans**: TBD
**UI hint**: yes

### Phase 6: 净房重跑与升级托管 (Clean-Room Rerun & Escalation Custody)
**Goal**: 已被污染的任务可经净房重跑恢复（旧拒绝上下文不再传染新执行），终态被拒意图不再占据 frontier，持续性 planner 失效升级为系统托管声明再到操作员显式告警——v1 治理闭环收口。
**Mode:** mvp
**Depends on**: Phase 2, Phase 3 (E 是本里程碑唯一的引擎领取逻辑改动，须在 C/H-L2 稳定后实施；H-L3 复用 H-L2 连败计数)
**Requirements**: RERUN-01, RERUN-02, RERUN-03, PLAN-06
**Success Criteria** (what must be TRUE):
  1. UI rerun 交互勾选净房模式后：fresh=true 以原意图文本新建 intent 节点（derived_from 血缘指向旧 intent），新会话不加载旧 transcript，旧拒绝上下文不再进入新执行（RERUN-01/03）
  2. 终态旧 intent 处置生效：走 cancel 路径或置 blocked_reason 并跳过领取——Frontier/ClaimIntent 新增 blocked_reason 过滤（确认为新行为，非既有复用），不硬删 transcript，不用 SoftDeleteIntent 处理终态（RERUN-02）
  3. 连续 N=3 轮（可配）拒止后 hints 出现系统托管声明，下一轮 planner 不再空轮；再连败 M=2（可配）活动流发显式告警提示操作员介入；全程只复用 hint/activity/notify 既有通道，不引入新状态机（§19-7，PLAN-06）
  4. 端到端恢复验收：对一个已被拒止污染的任务，净房重跑被拒 intent 后任务在无旧拒绝上下文情况下恢复正常推进（至目标达成或如实失败）；连败基数经 Phase 3 的 activity 回溯在重启后仍有效，托管/告警不因重启清零而失效（E/H-L3 上线后既有方案 G 的 hint 纠偏过渡手段退役）
**Plans**: TBD
**UI hint**: yes
**Notes**: 计划期建议走 `/gsd-plan-phase --research-phase`：E 的终态意图处置（cancel vs blocked_reason 跳过领取）是开放设计决策，领取过滤语义需专门一轮核对。

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 提示词纪律与迁移 | 0/0 | Not started | - |
| 2. 图谱治理 | 0/0 | Not started | - |
| 3. planner 硬防线 | 0/0 | Not started | - |
| 4. 授权凭据与任务模板 | 0/0 | Not started | - |
| 5. 度量与文档收尾 | 0/0 | Not started | - |
| 6. 净房重跑与升级托管 | 0/0 | Not started | - |
