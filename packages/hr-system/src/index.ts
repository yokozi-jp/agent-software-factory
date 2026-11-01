// `.` の入口 (docs/adr/0052、docs/adr/0054)。再 export だけを書く。契約 (型) は domain/ にあり、ky の実装は `./client` にある。
export type { Employee, HrSystemClient } from "./domain/employee.ts";
