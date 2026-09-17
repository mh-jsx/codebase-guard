import { mkdir } from "node:fs/promises";
import path from "node:path";

await mkdir(path.resolve(process.cwd(), "release"), { recursive: true });
