# ARTEX — AI 拒止与记录污染治理

## What This Is

ARTEX 是一个 AI 自主渗透测试系统：Go 单二进制后端驱动 LLM agent（planner/worker 等 8 个角色）对授权目标执行侦察、利用与验证，Next.js 前端静态导出后嵌入二进制提供操作台。本项目的任务是在代码层面**长久、彻底地治理「AI 拒止与记录污染」**：模型以道德/合规理由拒绝执行授权任务、并把「拒绝」写进探索图（facts），导致后续 planner/worker 读图后被传染、级联拒止的问题。治理范围覆盖写入侧、读取侧、规划侧、授权凭据、度量闭环与操作文档。

## Core Value

**在授权范围内，agent 全程正常执行任务，拒止声明不再进入探索图、不再传染后续规划，且污染一旦发生操作员可在代码层面精确清除/修正/审计。**

## Requirements

### Validated

<!-- 棕地基线：以下能力已存在于代码库（来源：.planning/codebase/ 地图，2026-10-10 映射） -->

- ✓ 探索图事件溯源存储：intents/facts/findings 节点 + 边 + activity 全量落 PostgreSQL，`fact.state` 已预留 `dismissed` 枚举（db/schema.sql:234） — existing
- ✓ facts 摘要失效机制：`SetNodeState` bump `content_version`，cold-digest 的 `blockSignature` 自动重算 — existing
- ✓ 提示词种子与 reseed 范式：六个内置 agent 提示词常量集中 `BuiltinPromptSeeds()`，orchestration.go 有 goals/mainagent/planner/worker 四个 reseed 范式函数 — existing
- ✓ 任务约束注入：`constraintBlock` 把 allow/deny 约束作为最高优先级红线注入 planner/worker/goals 抽取 — existing
- ✓ 拦截审查管线：guard PreToolUse 钩子 + intercept 规则 + LLM 兜底裁判（wireInterceptReviewer，含 verdict 解析/llmrec 台账/失败策略基建） — existing
- ✓ 意图干预通道：worker `ExecuteWithMessage` resume 机制、`add_hint` 通道、activity/broadcast/notify 通知链 — existing
- ✓ 任务归档/恢复：按表名数组的快照与恢复机制（governance_log、task_authorizations 独立表按此接线） — existing
- ✓ scheduler watermark 模式：5s tick + `NewFindingsSince` 等既有写法（方案 N 审计 job 复用） — existing
- ✓ reporter/retester 种子与一次性迁移范式：`upgradeReporterTriggerMessage`、`seedFindingRetester` 事务 + advisory lock — existing

### Active

<!-- 全部来自 docs/拒止污染治理方案.md（二审定稿），一期 + 二期全部纳入。 -->

**一期·提示词与迁移（方案 A + H 第一层 + I + M）**
- [ ] A：worker/pentest/planner 等 8 个 agent 默认提示词追加「授权与执行纪律」段（优先级仲裁：deny 约束 > 授权凭据 > 执行纪律），存量库 reseed 全覆盖（含 pentest/auto 新增 reseed、reporter/retester 一次性迁移，retester 并入 seedFindingRetester advisory lock）
- [ ] H-L1：planner 提示词纪律段（禁止把拒绝规划当结论，三出口之外无合法出口）
- [ ] M：任务描述模板（3–5 个场景模板常量表 + UI 一键填充 + 同步填充方案 J 凭据初值与成对约束集）

**一期·图谱治理（方案 C + D/L）**
- [ ] C：facts 删除（硬删）/ 软失效（dismissed）/ 修改摘要能力 — DB helper（kind='fact' 锁定、UpdateFactPayload 必须 bump content_version）+ API（DELETE/PATCH /api/exploration/facts/{id}）+ governance_log 独立审计表（含归档快照/恢复接线）+ UI（NodeDetailSheet 作废/删除/编辑、显示已否定开关 include_dismissed、降透明度渲染）
- [ ] C-Q1：dismissed fact 对模型侧全路径隐藏 — 列表/合并页/relatedTaskOverviews/cold-digest/graph_overview 直读点/GetNode 单点读取（占位文案），agent 侧不透传 include_dismissed
- [ ] D/L：record_fact 写入侧处置，L 降级为主（confidence→inferred + note）、D 拒收为辅（同批 items 连续 2 次命中升级报错）；Q3 自指关键词集共用 helper（禁用裸"拒绝"）；prove_goal evidence 同校验

**一期·拒止硬防线（方案 H 第二层 + K）**
- [ ] H-L2：planner 拒止分流器 — WriteCounts 加 Intents 计数，判定（0 新产 intent + GoalMet=false + 未达成目标存在 + frontier/running 均空）→ 纠偏 user 消息重试一次 → 连败计数（activity 回溯恢复基数）
- [ ] K：ClassifyPlannerRound 裁判二分类（复用 judge 基建不复用规则表、仅疑似场景触发、任务级节流 10 分钟可配、fail_action 宁漏勿错）

**一期·授权凭据（方案 J）**
- [ ] J：task_authorizations 独立表（authorizer/valid_until/scope/action_level，含归档/恢复接线）+ get_authorization 只读工具 + guard ReviewBackground 扩展接线 + 有效期 fail-safe（过期转 deny/ask 可配 + 前后 activity 提醒）+ 提示词补句（凭据不减损 deny 约束）

**一期·度量与文档收尾（方案 N + F + B）**
- [ ] N：拒止基线报表 — scheduler watermark 审计 job（按入库原样统计、不看 dismissed 过滤）+ 独立结果表 + 只读 API + 任务详情"拒止审计"卡片（条目跳转方案 C 作废/删除）
- [ ] F：README「拒止/误拦排查」小节（拦截审批页/LLM 兜底裁判配置/审批记录处置入口）
- [ ] B：README「任务创建」授权描述模板 + 操作规程

**二期（本次一并纳入 v1）**
- [ ] E：被拒意图净房重跑 — UI 勾选 + `fresh=true` 参数 + derived_from 血缘 + 终态旧 intent 走 cancel/跳过领取（Frontier/ClaimIntent 增加 blocked_reason 过滤，不硬删 transcript）
- [ ] H-L3：轮次连败升级托管 — 连败 N=3 挂 hint 系统接管声明 + 再连败 M=2 显式告警通知操作员（参数可配，复用 hint/activity/notify 既有机制）

### Out of Scope

- findings 的"已否定"入口 — 现有 PATCH findings status 已可否认漏洞，不重复建设（Q5）
- 批量勾选作废 facts — 首期不做，靠 kind/q 过滤 + 人工辨认（Q2/5.3）
- worker 侧删除/改写 facts 的 agent 工具 — 给模型开历史改写能力引入新污染风险，删改只走 API+UI 人操作（5.1 约束 5）
- 用 tasks 行内 JSON 列承载授权凭据 — 避开 json_populate_record 整行 UPDATE 的 schema 漂移（12.2.1）
- UI 手工改提示词作为治理手段 — 本项目目标即代码层面的长久治理（文档范围声明）

## Context

- **需求唯一来源**：`docs/拒止污染治理方案.md`（二审定稿，9.2 节 Q1–Q15 全部拍板）。该文档含逐条代码证据链（文件:行号）、方案 A–N 详细设计、验收标准 19 条、实施顺序 6 步、回滚方案。实施时以该文档为准，修订后表述以 Q1/Q2/Q3/Q13 修订版为准。
- **问题成因链**：提示词红线缺"已授权必须执行"对冲 → worker 把拒绝写成 confirmed fact → planner 读图被传染 → 级联拒止/空轮空转；另有 rerunIntent 原样恢复拒绝对话、平台自身拦截链路误杀两个放大器。
- **棕地现状**：Go 1.26 单二进制（264 条路由、~50 agent 工具、58 张表）+ Next.js 16 静态导出嵌入；探索图 facts 无删除/修改入口，dismissed 状态从未使用。
- **代码库地图**：`.planning/codebase/`（STACK/ARCHITECTURE/STRUCTURE/CONVENTIONS/TESTING/INTEGRATIONS/CONCERNS，2026-10-10 映射）。
- **工作量预估**（文档 §17）：一期约 5.5–6.5 天，二期 E + H-L3 视一期效果，本次一并纳入。

## Constraints

- **Tech stack**: Go 1.26（单包扁平布局，依赖方向 cmd → server → 域包 → db）+ Next.js 16 静态导出；提示词经 reseed 追加版本不覆盖 — 与既有架构模式保持一致
- **数据安全**: UpdateFactPayload 必须 bump content_version（UpdateGoalPayload 不 bump，不能照抄）；审计落独立表不落 activity（归档会级联删除）；关键词集禁用裸"拒绝"防误伤真实否定观察
- **优先级仲裁**: deny 约束 > 授权凭据 > 默认执行纪律 — 所有提示词段与凭据逻辑必须遵守该序（二审修订③）
- **验证口径**: 每个方案带验收标准（文档 §19，16+ 条），含构造性验收（如"connection refused 不触发拦截"）；H 第三层二期条目本次纳入后正常验收
- **回滚**: 所有改动须可回滚（reseed 追加版本、独立表、settings flag 开关、分流器独立于主路径）

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| D1: facts 增加删除/修改能力 | 比 UI 改提示词更彻底，schema dismissed/content_version 均为现成预留 | — Pending |
| D2: 需要 UI 改动 | NodeDetailSheet 加作废/删除/编辑 + 显示已否定开关 | — Pending |
| Q1: dismissed 对模型侧全路径隐藏（含单点读取占位） | 血缘/历史对话会漏回原文，单点不过滤等于没隐藏 | — Pending |
| Q2: 审计落独立表 governance_log | activity 随归档级联删除会无痕；activity 照旧双写供即时展示 | — Pending |
| Q3: 关键词集自指模式、禁用裸"拒绝" | "connection refused/403 拒绝访问"是高频真实观察，裸匹配必误伤 | — Pending |
| Q4: 方案 E 排二期 → 用户拍板纳入本次 | 功能与 H-L3 重叠，原计划看一期效果再定 | — Pending |
| Q7: H 三层递进，L1+L2 本期、L3 排二期 → 用户拍板纳入本次 | L2 是"彻底"的关键；L3 参数 N=3/M=2 可配 | — Pending |
| Q11: 方案 J 本期做，凭据用独立表 task_authorizations | 避开归档恢复 schema 漂移；过渡期诚实用 B 文本授权 | — Pending |
| Q13: L 降级为主、D 拒收为辅（同批 items 连续 2 次升级） | 报错重写可能引发新空转；降级把污染变成复核任务 | — Pending |
| Q12: 方案 K 并入 H 第二层同批实现 | 复用 judge 基建，独立轻量 reviewer 通道，带节流 | — Pending |
| v1 范围：一期 + 二期全部纳入（用户确认） | 文档已完整定稿，无需分期观察 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-10 after initialization*
