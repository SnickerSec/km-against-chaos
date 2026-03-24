import type { ChaosCard, KnowledgeCard } from "./types.js";

// Chaos Cards (Black) — the prompts
export const CHAOS_CARDS: ChaosCard[] = [
  { id: "c1", text: "The root cause of last Friday's outage was ___.", pick: 1 },
  { id: "c2", text: "Our new onboarding process now includes a mandatory session on ___.", pick: 1 },
  { id: "c3", text: "The knowledge base article that gets the most views is about ___.", pick: 1 },
  { id: "c4", text: "According to the post-mortem, the real problem was ___.", pick: 1 },
  { id: "c5", text: "The CTO just announced that our top priority is ___.", pick: 1 },
  { id: "c6", text: "Nobody reads the documentation because ___.", pick: 1 },
  { id: "c7", text: "The latest Confluence page is just 500 words about ___.", pick: 1 },
  { id: "c8", text: "In the all-hands meeting, someone actually asked about ___.", pick: 1 },
  { id: "c9", text: "Step 1: ___. Step 2: ___. Step 3: Profit.", pick: 2 },
  { id: "c10", text: "The tribal knowledge that left when Dave quit was ___.", pick: 1 },
  { id: "c11", text: "Our AI chatbot was trained on ___ and now it won't stop recommending it.", pick: 1 },
  { id: "c12", text: "The IT Service Desk's most common ticket is about ___.", pick: 1 },
  { id: "c13", text: "The lessons learned document was supposed to cover ___, but instead it just said ___.", pick: 2 },
  { id: "c14", text: "Management thinks ___ is the solution to every problem.", pick: 1 },
  { id: "c15", text: "The new hire's first Slack message was asking about ___.", pick: 1 },
  { id: "c16", text: "Our knowledge management strategy can be summarized as ___.", pick: 1 },
  { id: "c17", text: "The only thing worse than no documentation is documentation about ___.", pick: 1 },
  { id: "c18", text: "What's actually in that 200-page runbook? ___.", pick: 1 },
  { id: "c19", text: "The real reason we have 47 Slack channels is ___.", pick: 1 },
  { id: "c20", text: "The meeting could have been an email, but the email would have been about ___.", pick: 1 },
  { id: "c21", text: "Our best practice for knowledge sharing is ___.", pick: 1 },
  { id: "c22", text: "The intern documented ___ and accidentally became a hero.", pick: 1 },
  { id: "c23", text: "What did we learn from the retrospective? ___.", pick: 1 },
  { id: "c24", text: "The SharePoint site is a graveyard of ___.", pick: 1 },
  { id: "c25", text: "After the reorg, nobody knows who owns ___.", pick: 1 },
];

// Knowledge Cards (White) — the answers
export const KNOWLEDGE_CARDS: KnowledgeCard[] = [
  { id: "k1", text: "A 47-slide PowerPoint from 2019" },
  { id: "k2", text: "Undocumented tribal knowledge" },
  { id: "k3", text: "An acronym nobody can define" },
  { id: "k4", text: "The password taped to the monitor" },
  { id: "k5", text: "A Confluence page with 'TODO: fill this in later'" },
  { id: "k6", text: "Aggressive knowledge hoarding" },
  { id: "k7", text: "Another mandatory training video" },
  { id: "k8", text: "That one guy who knows everything but won't write it down" },
  { id: "k9", text: "Copy-pasting from Stack Overflow without reading" },
  { id: "k10", text: "A process diagram that looks like spaghetti" },
  { id: "k11", text: "Scheduling a meeting to discuss when to schedule the meeting" },
  { id: "k12", text: "The shared drive nobody can find" },
  { id: "k13", text: "An out-of-date wiki page marked 'CURRENT'" },
  { id: "k14", text: "Blaming the intern" },
  { id: "k15", text: "A Jira ticket from three sprints ago" },
  { id: "k16", text: "Saying 'it's in the runbook' when there is no runbook" },
  { id: "k17", text: "Shadow IT" },
  { id: "k18", text: "A knowledge transfer that was just a 10-minute screen share" },
  { id: "k19", text: "Replying-all to 400 people" },
  { id: "k20", text: "The VPN that only works on Tuesdays" },
  { id: "k21", text: "Digital transformation buzzwords" },
  { id: "k22", text: "An AI that hallucinates company policy" },
  { id: "k23", text: "The org chart that hasn't been updated since the merger" },
  { id: "k24", text: "A post-mortem with no action items" },
  { id: "k25", text: "A Center of Excellence that produces nothing" },
  { id: "k26", text: "Putting everything in a spreadsheet" },
  { id: "k27", text: "The onboarding buddy who quit on day two" },
  { id: "k28", text: "Documenting in a personal notebook that goes home every night" },
  { id: "k29", text: "Single point of failure (it's Gary)" },
  { id: "k30", text: "A taxonomy that took 6 months to build and nobody uses" },
  { id: "k31", text: "Institutional amnesia" },
  { id: "k32", text: "A chatbot trained on the wrong department's data" },
  { id: "k33", text: "Renaming the team and calling it a strategy" },
  { id: "k34", text: "The 'quick win' that took 8 months" },
  { id: "k35", text: "An email chain with 73 replies and no resolution" },
  { id: "k36", text: "Best practices from a company that went bankrupt" },
  { id: "k37", text: "A community of practice that meets once and disbands" },
  { id: "k38", text: "That legacy system nobody dares to touch" },
  { id: "k39", text: "Knowledge management as a line item in nobody's budget" },
  { id: "k40", text: "The exit interview nobody reads" },
  { id: "k41", text: "A lessons learned database with one entry" },
  { id: "k42", text: "Saying 'we should document this' and never doing it" },
  { id: "k43", text: "A Slack thread that IS the documentation" },
  { id: "k44", text: "Paying consultants to tell you what your employees already know" },
  { id: "k45", text: "The search function that returns everything except what you need" },
  { id: "k46", text: "SOPs written in Comic Sans" },
  { id: "k47", text: "A knowledge graph that only the creator understands" },
  { id: "k48", text: "Microservices that nobody can explain" },
  { id: "k49", text: "Compliance training on a topic that doesn't apply to your role" },
  { id: "k50", text: "A SharePoint migration that lost half the files" },
];

export function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
