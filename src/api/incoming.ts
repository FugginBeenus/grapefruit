import { rpcCall } from "./sidecar";

export interface IncomingFile {
  path: string;
  name: string;
  title: string;
  artist: string;
  album: string;
  format: string;
  size: number;
}

export function listIncoming() {
  return rpcCall<IncomingFile[]>("list_incoming");
}

export function importIncoming(paths: string[]) {
  return rpcCall<{ moved: number; errors: string[] }>("import_incoming", { paths });
}
