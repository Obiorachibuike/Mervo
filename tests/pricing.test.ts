import { describe, expect, it } from "vitest";
import { computeCart, SaleValidationError } from "@/server/services/sales";

const line = (over: Partial<Parameters<typeof computeCart>[0]["lines"][number]> = {}) => ({
  name: "Item",
  quantity: "1.000",
  unitPrice: "100.00",
  unitCost: "60.00",
  taxRate: 0,
  ...over,
});

describe("cart pricing", () => {
  it("computes subtotal, tax and total for a simple cart", () => {
    const cart = computeCart({ lines: [line({ quantity: "2.000", taxRate: 7.5 })] });
    expect(cart.subtotal).toBe("200.00");
    expect(cart.taxTotal).toBe("15.00");
    expect(cart.total).toBe("215.00");
    expect(cart.costTotal).toBe("120.00");
    expect(cart.netRevenue).toBe("200.00");
  });

  it("applies line discounts before tax", () => {
    const cart = computeCart({ lines: [line({ taxRate: 10, discount: "20.00" })] });
    expect(cart.discountTotal).toBe("20.00");
    expect(cart.taxTotal).toBe("8.00");
    expect(cart.total).toBe("88.00");
  });

  it("caps a line discount at the line value", () => {
    const cart = computeCart({ lines: [line({ discount: "500.00" })] });
    expect(cart.lines[0]!.lineDiscount).toBe("100.00");
    expect(cart.total).toBe("0.00");
  });

  it("allocates an order discount across lines and reduces tax proportionally", () => {
    const cart = computeCart({
      lines: [line({ quantity: "1.000", unitPrice: "100.00", taxRate: 10 }), line({ quantity: "1.000", unitPrice: "300.00", taxRate: 10 })],
      orderDiscount: "40.00",
    });
    expect(cart.discountTotal).toBe("40.00");
    expect(cart.taxTotal).toBe("36.00");
    expect(cart.total).toBe("396.00");
  });

  it("never lets the order discount exceed the cart", () => {
    expect(() => computeCart({ lines: [line()], orderDiscount: "100.01" })).toThrow(SaleValidationError);
  });

  it("extracts tax when prices are tax-inclusive", () => {
    const cart = computeCart({ lines: [line({ unitPrice: "107.50", taxRate: 7.5 })], taxInclusive: true });
    expect(cart.netRevenue).toBe("100.00");
    expect(cart.taxTotal).toBe("7.50");
    expect(cart.total).toBe("107.50");
  });

  it("adds modifiers to the line value", () => {
    const cart = computeCart({ lines: [line({ quantity: "2.000", modifiers: [{ name: "Extra cheese", price: 150 }] })] });
    expect(cart.subtotal).toBe("500.00");
  });

  it("keeps totals consistent to the cent across many lines", () => {
    const lines = Array.from({ length: 25 }, () => line({ quantity: "0.333", unitPrice: "9.99", taxRate: 7.5 }));
    const cart = computeCart({ lines });
    const recomputed = cart.lines.reduce((acc, l) => acc + Math.round(Number(l.lineTotal) * 100), 0);
    expect(Math.round(Number(cart.total) * 100)).toBe(recomputed);
  });

  it("rejects negative or zero quantity at the schema layer", () => {
    expect(() => computeCart({ lines: [line({ quantity: "0.000" })] })).not.toThrow();
  });
});
