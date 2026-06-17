export function reportToMarkdown(report) {
  const lines = [];
  lines.push(`# CS2 Demo AI Coach Report`);
  lines.push("");
  lines.push(`- 地图：${report.match.map}`);
  lines.push(`- 比分：${report.overview.score}`);
  lines.push(`- 重点玩家：${report.focusPlayer.name}`);
  lines.push(`- 目标位置：${report.targetRole}`);
  lines.push(`- 证据数量：${report.evidenceCount}`);
  if (report.aiCoach) {
    lines.push(`- AI 模式：${report.aiCoach.mode}`);
  }
  lines.push("");
  lines.push(`## 比赛概览`);
  lines.push(report.overview.summary);
  if (report.aiCoach?.summary) {
    lines.push("");
    lines.push(`AI 总结：${report.aiCoach.summary}`);
  }
  lines.push("");
  lines.push(`- 最大问题：${report.overview.biggestProblem}`);
  lines.push(`- 最大优势：${report.overview.biggestStrength}`);
  lines.push("");
  lines.push(`## 个人报告`);
  report.personalReports.forEach((personal) => {
    lines.push(`### ${personal.player.name}`);
    lines.push(`推荐角色：${personal.recommendedRoles.join(" / ")}`);
    lines.push(personal.roleReason);
    lines.push(personal.targetRoleFit);
    lines.push("");
    personal.habits.forEach((habit) => {
      lines.push(`- ${habit.title}（严重程度：${habit.severity}）`);
      habit.evidence.forEach((item) => {
        lines.push(`  - 证据：第 ${item.round} 回合 ${item.time}，${item.location}，${item.event}`);
      });
      lines.push(`  - 改法：${habit.specificFix}`);
      lines.push(`  - 训练：${habit.training}`);
    });
    lines.push("");
  });
  lines.push(`## 团队报告`);
  lines.push(report.teamReport.style);
  lines.push("");
  report.teamReport.weaknesses.forEach((weakness) => lines.push(`- 短板：${weakness}`));
  report.teamReport.strengths.forEach((strength) => lines.push(`- 强项：${strength}`));
  lines.push("");
  lines.push(`## 关键回合`);
  report.keyRounds.forEach((round) => {
    lines.push(`### ${round.title}`);
    lines.push(`结果：${round.result}`);
    lines.push(`主要问题：${round.mainMistake}`);
    lines.push(`更好打法：${round.betterPlay}`);
    round.timeline.forEach((event) => {
      lines.push(`- ${event.time} ${event.location}：${event.event}`);
    });
    lines.push("");
  });
  lines.push(`## 专属战术`);
  report.tactics.forEach((tactic) => {
    lines.push(`### ${tactic.name}`);
    lines.push(`适用：${tactic.map} ${tactic.side}，${tactic.economyCondition}`);
    lines.push(`目标：${tactic.objective}`);
    lines.push(`适合原因：${tactic.whyFits}`);
    tactic.assignments.forEach((assignment) => {
      lines.push(`- ${assignment.player}：${assignment.role}，${assignment.duty}`);
    });
    lines.push(`执行时机：${tactic.timing}`);
    lines.push(`失败预案：${tactic.contingency}`);
    lines.push("");
  });
  lines.push(`## 训练计划`);
  report.trainingPlan.weekPlan.forEach((task) => {
    lines.push(`- ${task.title}`);
    lines.push(`  - 目标：${task.objective}`);
    lines.push(`  - 练法：${task.drill}`);
    lines.push(`  - 验收：${task.successMetric}`);
  });
  lines.push("");
  lines.push(`> ${report.caveat}`);
  lines.push("");
  return lines.join("\n");
}
