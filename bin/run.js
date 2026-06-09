#!/usr/bin/env node --import tsx

import { execute } from "@oclif/core";

await execute({ dir: import.meta.url });
