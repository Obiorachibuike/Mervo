import { describe, expect, it } from "vitest";
import { add, allocate, cmp, eq, formatMoney, fromMinor, lineValue, money, multiply, percentOf, sub, sum, toMinor } from "@/server/lib/money";

describe("decimal-safe money", () => {
  it("parses and formats without floating point drift", () => {
    expect(toMinor("0.1")).toBe(10n);
    expect(toMinor("1234.56")).toBe(123456n);
    expect(add("0.1", "0.2")).toBe("0.30");
    expect(add("0.1", "0.2", "0.3")).toBe("0.60");
    expect(sub("100.00", "33.33")).toBe("66.67");
    expect(money(19.999)).toBe("20.00");
    expect(money(-5)).toBe("-5.00");
    expect(fromMinor(1n)).toBe("0.01");
  });

  it("avoids the classic 0.1+0.2 float error across 1000 additions", () => {
    let total = "0.00";
    for (let i = 0; i < 1000; i++) total = add(total, "1.01");
    expect(total).toBe("1010.00");
  });

  it("rounds half up on multiplication", () => {
    expect(multiply("10.00", "1.5")).toBe("15.00");
    expect(multiply("0.05", "0.5")).toBe("0.03"); // 2.5 cents → 3
    // multiply takes 2-decimal factors; use percentOf for rates like 7.5%
    expect(multiply("3.00", "0.08")).toBe("0.24");
    expect(percentOf("3.00", "7.5")).toBe("0.23");
    expect(percentOf("200.00", "7.5")).toBe("15.00");
  });

  it("computes tax percentages exactly", () => {
    expect(percentOf("100.00", "7.5")).toBe("7.50");
    expect(percentOf("8500.00", "7.5")).toBe("637.50");
    expect(percentOf("3333.33", "7.5")).toBe("250.00");
  });

  it("compares and sums safely", () => {
    expect(cmp("10.00", "10.00")).toBe(0);
    expect(eq("10.00", "10.0")).toBe(true);
    expect(sum(["10.00", "20.50", "0.50"])).toBe("31.00");
  });

  it("allocates an amount without losing a cent", () => {
    const parts = allocate("100.00", [1, 1, 1]);
    expect(parts).toEqual(["33.33", "33.33", "33.34"]);
    const shares = allocate("10.00", [3, 7]);
    expect(sum(shares)).toBe("10.00");
  });

  it("values quantity × price", () => {
    expect(lineValue("2.500", "1200.00")).toBe("3000.00");
    expect(lineValue("0.333", "9.99")).toBe("3.33");
  });

  it("rejects invalid amounts instead of coercing", () => {
    expect(() => toMinor("abc")).toThrow();
    expect(() => toMinor("1.2.3")).toThrow();
  });

  it("formats currency per locale symbol", () => {
    expect(formatMoney("1234.56", "NGN")).toBe("₦1,234.56");
    expect(formatMoney("1234.56", "USD")).toBe("$1,234.56");
    expect(formatMoney("-50", "GBP")).toBe("-£50.00");
    expect(formatMoney("1500000", "NGN", { compact: true })).toBe("₦1.5M");
  });
});
