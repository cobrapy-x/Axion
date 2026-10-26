// SPDX-License-Identifier: Apache-2.0
import type { FetSpec } from '../../physics/semiconductors';
import { fetModel } from '../../physics/semiconductors';

/**
 * Logic-level IRLZ44N: VGS(th) 1–2 V, RDS(on) ≈ 0.025 Ω at VGS = 5 V.
 * IRF520: VGS(th) 2–4 V, RDS(on) ≈ 0.27 Ω at 10 V (≈ 0.4 Ω at a 5 V gate in this switch model).
 * The solver warns above 1 A anyway (short-circuit check), so maxAmps is set there.
 */
const SPECS: Record<string, FetSpec> = {
  IRLZ44N: { name: 'IRLZ44N', type: 'n', vth: 2, rdsOn: 0.025, maxAmps: 1, vdss: 55 },
  IRF520: { name: 'IRF520', type: 'n', vth: 4, rdsOn: 0.4, maxAmps: 1, vdss: 100 },
};

export default fetModel((ctx) => SPECS[String(ctx.props.model)] ?? SPECS.IRLZ44N);
