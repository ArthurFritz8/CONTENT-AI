import { strictEqual, throws } from "node:assert";
import { test } from "node:test";
import { durationDeviationPercent, exceedsDurationDeviation } from "./duration.ts";

test("durationDeviationPercent: cálculo simétrico acima e abaixo do target", () => {
  strictEqual(durationDeviationPercent(20, 30), 50);
  strictEqual(durationDeviationPercent(20, 10), 50);
  strictEqual(durationDeviationPercent(20, 20), 0);
});

test("exceedsDurationDeviation: limite de 50% é exclusivo", () => {
  strictEqual(exceedsDurationDeviation(20, 30), false);
  strictEqual(exceedsDurationDeviation(20, 30.1), true);
  strictEqual(exceedsDurationDeviation(20, 9.9), true);
});

test("exceedsDurationDeviation: threshold configurável", () => {
  strictEqual(exceedsDurationDeviation(20, 25, 20), true);
  strictEqual(exceedsDurationDeviation(20, 23, 20), false);
});

test("rejeita targets inválidos", () => {
  throws(() => durationDeviationPercent(0, 10), RangeError);
  throws(() => durationDeviationPercent(-5, 10), RangeError);
  throws(() => durationDeviationPercent(10, -1), RangeError);
});
