// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

const create: ModelFactory = () => ({
  resistors: () => [['1', '2']],
});

export default create;
