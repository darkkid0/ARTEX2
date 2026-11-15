"use client";

import { ApprovalRecords } from "@/components/approval-records";

export function InterceptTab({ taskId }: { taskId: string }) {
  // 与会话页的分栏面板保持一致：实色底 + 细边框。
  // 之前直接铺在页面底色上，会透出背景网格，看起来"没有背景"。
  return (
    <div className="bg-card flex min-w-0 flex-col gap-4 rounded-lg border p-4">
      <ApprovalRecords key={taskId} taskId={taskId} />
    </div>
  );
}
