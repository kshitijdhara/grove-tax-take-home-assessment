export function isNode(value: EventTarget | null): value is Node {
  return value !== null && "nodeType" in value;
}
