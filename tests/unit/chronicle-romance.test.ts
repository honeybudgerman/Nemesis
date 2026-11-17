import { describe, expect, it } from "vitest";
import { chronicleFallback, chronicleMessages } from "@/engine/ai/story";
import { addCourtDays } from "@/data/court/availability";

describe("relationship context in chronicles", () => {
  it("uses documented statuses in the prompt and fallback without awarding anything", () => {
    const relationships = [{ name: "Юки Эшгрейв", status: "PARTNER" as const }];
    const messages = chronicleMessages({ heroName: "Субару", kingdomName: "Алый лотос", chapterNumber: 1,
      chapterTitle: "Начало", summary: "Глава завершена", decision: null, boss: null, events: [], relationships });
    expect(messages[1].content).toContain("Юки Эшгрейв: PARTNER");
    expect(chronicleFallback("Субару укрепил королевство.", relationships)).toContain("Они выбрали совместную жизнь");
    expect(chronicleFallback("Глава завершена.", [])).toBe("Глава завершена.");
  });

  it("counts calendar days across month and year boundaries", () => {
    expect(addCourtDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addCourtDays("2028-02-27", 3)).toBe("2028-03-01");
  });
});
