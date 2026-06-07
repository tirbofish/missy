import path from "node:path";
import { MistralToolDefinition } from "./mcp.ts";

export type FileOperationApprovalRequest = {
  action: "delete" | "move" | "overwrite";
  destinationPath?: string;
  sourcePath?: string;
  subject: "file" | "folder";
  targetPath?: string;
};

export type FileOperationApprovalHandler = (
  request: FileOperationApprovalRequest,
) => Promise<boolean>;

export const FILESYSTEM_TOOL_NAMES = {
  copy: "missy_filesystem_copy",
  delete: "missy_filesystem_delete",
  list: "missy_filesystem_list",
  mkdir: "missy_filesystem_mkdir",
  move: "missy_filesystem_move",
  read: "missy_filesystem_read",
  stat: "missy_filesystem_stat",
  writeText: "missy_filesystem_write_text",
} as const;

export const filesystemTools: MistralToolDefinition[] = [
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.stat,
      description:
        "Inspect metadata for a local filesystem path. Use only in DMs.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Local path to inspect." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.list,
      description:
        "List files and folders in a local directory. Use only in DMs.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Local directory path." },
          limit: {
            type: "integer",
            description: "Maximum entries to return. Defaults to 100.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.read,
      description:
        "Read a local text file. Use only in DMs and avoid reading secrets unless the user explicitly asks.",
      parameters: {
        type: "object",
        properties: {
          maxBytes: {
            type: "integer",
            description: "Maximum bytes to read. Defaults to 20000.",
          },
          path: { type: "string", description: "Local file path." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.copy,
      description:
        "Copy a local file or folder to a new destination that does not already exist. Use only in DMs.",
      parameters: {
        type: "object",
        properties: {
          destinationPath: {
            type: "string",
            description: "New destination path. It must not already exist.",
          },
          sourcePath: {
            type: "string",
            description: "Existing source file or folder path.",
          },
        },
        required: ["sourcePath", "destinationPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.mkdir,
      description:
        "Create a local directory, including parent directories if needed. Use only in DMs.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to create." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.writeText,
      description:
        "Create or overwrite a local text file. Overwrite requires explicit Discord approval. Use only in DMs.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Text content to write." },
          overwrite: {
            type: "boolean",
            description:
              "Whether to overwrite an existing file. Defaults to false.",
          },
          path: { type: "string", description: "Local file path." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.move,
      description:
        "Move or rename a local file or folder after explicit Discord user approval. Use only in DMs.",
      parameters: {
        type: "object",
        properties: {
          destinationPath: {
            type: "string",
            description:
              "Destination local path. It must not already exist; choose the final filename or folder name.",
          },
          sourcePath: {
            type: "string",
            description: "Existing local source file or folder path.",
          },
        },
        required: ["sourcePath", "destinationPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.delete,
      description:
        "Delete a local file or folder after explicit Discord user approval. Use only in DMs. Folders require recursive=true.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Local path to delete." },
          recursive: {
            type: "boolean",
            description:
              "Required to delete non-empty folders. Defaults to false.",
          },
        },
        required: ["path"],
      },
    },
  },
];

function parseArgs(rawArguments: unknown): Record<string, unknown> {
  if (typeof rawArguments === "string") {
    return JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  }

  return rawArguments && typeof rawArguments === "object"
    ? rawArguments as Record<string, unknown>
    : {};
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = String(args[name] ?? "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function resolveLocalPath(value: string): string {
  return path.resolve(value);
}

function clampBytes(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(parsed, 200_000))
    : fallback;
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await Deno.stat(value);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }

    throw error;
  }
}

function statSubject(info: Deno.FileInfo): "file" | "folder" {
  return info.isDirectory ? "folder" : "file";
}

function serializeFileInfo(value: string, info: Deno.FileInfo) {
  return {
    accessedAt: info.atime?.toISOString(),
    createdAt: info.birthtime?.toISOString(),
    isDirectory: info.isDirectory,
    isFile: info.isFile,
    isSymlink: info.isSymlink,
    modifiedAt: info.mtime?.toISOString(),
    path: value,
    size: info.size,
  };
}

async function copyPath(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceInfo = await Deno.stat(sourcePath);

  if (sourceInfo.isDirectory) {
    await Deno.mkdir(destinationPath);

    for await (const entry of Deno.readDir(sourcePath)) {
      await copyPath(
        path.join(sourcePath, entry.name),
        path.join(destinationPath, entry.name),
      );
    }

    return;
  }

  await Deno.copyFile(sourcePath, destinationPath);
}

async function requestApprovalOrThrow(
  requestApproval: FileOperationApprovalHandler | undefined,
  request: FileOperationApprovalRequest,
): Promise<boolean> {
  if (!requestApproval) {
    throw new Error(
      "This filesystem operation requires a Discord approval prompt.",
    );
  }

  return await requestApproval(request);
}

async function statTool(args: Record<string, unknown>): Promise<unknown> {
  const resolvedPath = resolveLocalPath(requiredString(args, "path"));
  const info = await Deno.stat(resolvedPath);
  return serializeFileInfo(resolvedPath, info);
}

async function listTool(args: Record<string, unknown>): Promise<unknown> {
  const resolvedPath = resolveLocalPath(requiredString(args, "path"));
  const limit = Math.max(1, Math.min(Number(args.limit) || 100, 500));
  const entries = [];

  for await (const entry of Deno.readDir(resolvedPath)) {
    entries.push({
      isDirectory: entry.isDirectory,
      isFile: entry.isFile,
      isSymlink: entry.isSymlink,
      name: entry.name,
      path: path.join(resolvedPath, entry.name),
    });

    if (entries.length >= limit) {
      break;
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  return { entries, path: resolvedPath };
}

async function readTool(args: Record<string, unknown>): Promise<unknown> {
  const resolvedPath = resolveLocalPath(requiredString(args, "path"));
  const maxBytes = clampBytes(args.maxBytes, 20_000);
  const file = await Deno.open(resolvedPath, { read: true });

  try {
    const buffer = new Uint8Array(maxBytes);
    const bytesRead = await file.read(buffer);

    if (!bytesRead) {
      return { path: resolvedPath, text: "" };
    }

    return {
      path: resolvedPath,
      text: new TextDecoder().decode(buffer.slice(0, bytesRead)),
      truncated: bytesRead === maxBytes,
    };
  } finally {
    file.close();
  }
}

async function copyTool(args: Record<string, unknown>): Promise<unknown> {
  const sourcePath = resolveLocalPath(requiredString(args, "sourcePath"));
  const destinationPath = resolveLocalPath(
    requiredString(args, "destinationPath"),
  );

  await Deno.stat(sourcePath);

  if (await pathExists(destinationPath)) {
    throw new Error("Destination already exists.");
  }

  await Deno.stat(path.dirname(destinationPath));
  await copyPath(sourcePath, destinationPath);

  return { destinationPath, sourcePath };
}

async function mkdirTool(args: Record<string, unknown>): Promise<unknown> {
  const resolvedPath = resolveLocalPath(requiredString(args, "path"));
  await Deno.mkdir(resolvedPath, { recursive: true });
  return { path: resolvedPath };
}

async function writeTextTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const resolvedPath = resolveLocalPath(requiredString(args, "path"));
  const content = String(args.content ?? "");
  const overwrite = args.overwrite === true;
  const exists = await pathExists(resolvedPath);

  if (exists && !overwrite) {
    throw new Error("File already exists. Set overwrite=true to replace it.");
  }

  if (exists) {
    const info = await Deno.stat(resolvedPath);
    const approved = await requestApprovalOrThrow(requestApproval, {
      action: "overwrite",
      subject: statSubject(info),
      targetPath: resolvedPath,
    });

    if (!approved) {
      return { approved: false, message: "The user did not approve overwrite." };
    }
  }

  await Deno.mkdir(path.dirname(resolvedPath), { recursive: true });
  await Deno.writeTextFile(resolvedPath, content);

  return { approved: true, path: resolvedPath };
}

async function moveTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const sourcePath = resolveLocalPath(requiredString(args, "sourcePath"));
  const destinationPath = resolveLocalPath(
    requiredString(args, "destinationPath"),
  );
  const sourceInfo = await Deno.stat(sourcePath);

  if (await pathExists(destinationPath)) {
    throw new Error("Destination already exists.");
  }

  await Deno.stat(path.dirname(destinationPath));

  const approved = await requestApprovalOrThrow(requestApproval, {
    action: "move",
    destinationPath,
    sourcePath,
    subject: statSubject(sourceInfo),
  });

  if (!approved) {
    return { approved: false, message: "The user did not approve the move." };
  }

  await Deno.rename(sourcePath, destinationPath);
  return { approved: true, destinationPath, sourcePath };
}

async function deleteTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const targetPath = resolveLocalPath(requiredString(args, "path"));
  const info = await Deno.stat(targetPath);
  const approved = await requestApprovalOrThrow(requestApproval, {
    action: "delete",
    subject: statSubject(info),
    targetPath,
  });

  if (!approved) {
    return { approved: false, message: "The user did not approve deletion." };
  }

  await Deno.remove(targetPath, { recursive: args.recursive === true });
  return { approved: true, path: targetPath };
}

export async function callFilesystemTool(
  toolName: string,
  rawArguments: unknown,
  requestApproval?: FileOperationApprovalHandler,
): Promise<string> {
  const args = parseArgs(rawArguments);
  let result: unknown;

  switch (toolName) {
    case FILESYSTEM_TOOL_NAMES.copy:
      result = await copyTool(args);
      break;
    case FILESYSTEM_TOOL_NAMES.delete:
      result = await deleteTool(args, requestApproval);
      break;
    case FILESYSTEM_TOOL_NAMES.list:
      result = await listTool(args);
      break;
    case FILESYSTEM_TOOL_NAMES.mkdir:
      result = await mkdirTool(args);
      break;
    case FILESYSTEM_TOOL_NAMES.move:
      result = await moveTool(args, requestApproval);
      break;
    case FILESYSTEM_TOOL_NAMES.read:
      result = await readTool(args);
      break;
    case FILESYSTEM_TOOL_NAMES.stat:
      result = await statTool(args);
      break;
    case FILESYSTEM_TOOL_NAMES.writeText:
      result = await writeTextTool(args, requestApproval);
      break;
    default:
      throw new Error(`Unknown filesystem tool: ${toolName}`);
  }

  return JSON.stringify(result);
}
