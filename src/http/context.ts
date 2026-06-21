import type { AuthContext } from "../domain/auth/types";
import type { Env } from "../env";
import type { Logger } from "../shared/logger";

export interface AppVariables {
  requestId: string;
  auth: AuthContext | null;
  logger: Logger;
}

export type AppBindings = {
  Bindings: Env;
  Variables: AppVariables;
};
