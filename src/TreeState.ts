import type { TreeNodeId, NodeChangeEvent, NodePropertyChangeEvent, NodeChildrenChangeEvent, NodeMoveEvent, NodePropertyType } from "./treeTypes";
import { NodeState } from "./NodeState";

export class TreeState {
  private static BATCH_DELAY_MS = 33.3;

  private nodes: Map<TreeNodeId, NodeState>;
  private changeCallbacks: Map<TreeNodeId, Set<(events: NodeChangeEvent[]) => void>> = new Map();
  private globalChangeCallbacks: Set<(events: NodeChangeEvent[]) => void> = new Set();

  private batchTickTimeout: ReturnType<typeof setTimeout> | undefined;
  private batchedEvents: Map<TreeNodeId, NodeChangeEvent[]> = new Map();

  constructor() {
    this.nodes = new Map();
  }

  dispose() {
    if (this.batchTickTimeout) {
      clearTimeout(this.batchTickTimeout);
      this.batchTickTimeout = undefined;
    }
    this.batchedEvents.clear();
  }

  private scheduleBatchProcessing() {
    if (this.batchTickTimeout) {
      return;
    }

    this.batchTickTimeout = setTimeout(() => {
      this.batchTickTimeout = undefined;
      this.processBatchedEvents();
    }, TreeState.BATCH_DELAY_MS);
  }

  private processBatchedEvents() {
    for (const [nodeId, events] of this.batchedEvents) {
      // Get last property events per key and last move/children events
      let lastMoveEvent: NodeMoveEvent | null = null;
      let lastChildrenEvent: NodeChildrenChangeEvent | null = null;
      const propertyEventsByKey = new Map<string, NodePropertyChangeEvent>();

      for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (!lastMoveEvent && event.type === 'move') lastMoveEvent = event as NodeMoveEvent;
        if (!lastChildrenEvent && event.type === 'children') lastChildrenEvent = event as NodeChildrenChangeEvent;
        if (event.type === 'property') {
          const propertyEvent = event as NodePropertyChangeEvent;
          if (!propertyEventsByKey.has(propertyEvent.key)) {
            propertyEventsByKey.set(propertyEvent.key, propertyEvent);
          }
        }
      }

      // Combine all events with move and children events first
      const filteredEvents = [
        ...(lastMoveEvent ? [lastMoveEvent] : []),
        ...(lastChildrenEvent ? [lastChildrenEvent] : []),
        ...propertyEventsByKey.values()
      ];

      this.globalChangeCallbacks.forEach(listener => listener(filteredEvents));
      this.changeCallbacks.get(nodeId)?.forEach(listener => listener(filteredEvents));
    }

    this.batchedEvents.clear();
  }

  getAllNodes(): ReadonlyArray<NodeState> {
    return Array.from(this.nodes.values());
  }

  getNode(id: string): NodeState | undefined {
    return this.nodes.get(id);
  }

  getChildrenIds(nodeId: TreeNodeId): string[] {
    return this.getNode(nodeId)?.children ?? [];
  }

  getChildren(nodeId: TreeNodeId): NodeState[] {
    return this.getChildrenIds(nodeId)
      .map(id => this.nodes.get(id))
      .filter((node): node is NodeState => node !== undefined)
      .sort((a, b) => {
        const aDate = a.getProperty('_c') as string;
        const bDate = b.getProperty('_c') as string;
        if (!aDate) return -1;
        if (!bDate) return 1;
        return new Date(aDate).getTime() - new Date(bDate).getTime();
      });
  }

  moveNode(nodeId: TreeNodeId, newParentId: TreeNodeId | null): NodeState {
    let node = this.getNode(nodeId);
    // Undefined if the node is new
    const prevParentId = node ? node.parentId : undefined;
    if (!node) {
      node = new NodeState(nodeId, newParentId);
      this.nodes.set(nodeId, node);
    }

    if (prevParentId === newParentId) {
      return node;
    }

    node.parentId = newParentId;

    let childrenInNewParent: string[] | null = null;
    let childrenInOldParent: string[] | null = null;

    // Update children arrays in nodes
    if (prevParentId) {
      const oldParentNode = this.getNode(prevParentId);
      if (oldParentNode) {
        oldParentNode.children = oldParentNode.children.filter(child => child !== nodeId);
        childrenInOldParent = oldParentNode.children;
      } else {
        console.error(`Old parent node not found for ${prevParentId}`);
      }
    }

    if (newParentId !== null) {
      const newParentNode = this.nodes.get(newParentId);
      if (newParentNode) {
        newParentNode.children.push(nodeId);
        childrenInNewParent = newParentNode.children;
      } else {
        console.error(`New parent node not found for ${newParentId}`);
      }
    }

    // We notify the listeners in the end so that they have the final state of the tree

    this.notifyChange({
      type: 'move',
      nodeId: nodeId,
      oldParentId: prevParentId,
      newParentId,
    } as NodeMoveEvent);

    if (childrenInNewParent !== null && newParentId !== null) {
      this.notifyChange({
        type: 'children',
        nodeId: newParentId,
        children: childrenInNewParent.map(id => this.nodes.get(id)!),
      } as NodeChildrenChangeEvent);
    }

    if (childrenInOldParent !== null && prevParentId) {
      this.notifyChange({
        type: 'children',
        nodeId: prevParentId,
        children: childrenInOldParent.map(id => this.nodes.get(id)!),
      } as NodeChildrenChangeEvent);
    }

    return node;
  }

  setProperty(nodeId: string, key: string, value: NodePropertyType) {
    const node = this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    node.setProperty(key, value);

    this.notifyChange({
      type: 'property',
      nodeId: nodeId,
      key,
      value,
    } as NodePropertyChangeEvent);

    if (node.parentId !== null) {
      this.notifyChange({
        type: 'children',
        nodeId: node.parentId,
        children: this.getChildren(node.parentId),
      } as NodeChildrenChangeEvent);
    }
  }

  setTransientProperty(nodeId: string, key: string, value: NodePropertyType) {
    const node = this.getNode(nodeId);
    if (node) {
      node.setTransientProperty(key, value);
    }

    // @TODO: add info that it's a transient property
    this.notifyChange({
      type: 'property',
      nodeId: nodeId,
      key,
      value,
    } as NodePropertyChangeEvent);
  }

  addChangeCallback(nodeId: TreeNodeId, listener: (events: NodeChangeEvent[]) => void) {
    if (!this.changeCallbacks.has(nodeId)) {
      this.changeCallbacks.set(nodeId, new Set());
    }
    this.changeCallbacks.get(nodeId)!.add(listener);
  }

  removeChangeCallback(nodeId: TreeNodeId, listener: (events: NodeChangeEvent[]) => void) {
    this.changeCallbacks.get(nodeId)?.delete(listener);
  }

  addGlobalChangeCallback(listener: (events: NodeChangeEvent[]) => void) {
    this.globalChangeCallbacks.add(listener);
  }

  removeGlobalChangeCallback(listener: (events: NodeChangeEvent[]) => void) {
    this.globalChangeCallbacks.delete(listener);
  }

  private notifyChange(event: NodeChangeEvent) {
    let events = this.batchedEvents.get(event.nodeId);
    if (!events) {
      events = [];
      this.batchedEvents.set(event.nodeId, events);
    }

    events.push(event);
    this.scheduleBatchProcessing();

    // @TODO: have immediate events
    //this.globalChangeCallbacks.forEach(listener => listener(event));
    //this.changeCallbacks.get(event.nodeId)?.forEach(listener => listener(event));
  }

  printTree(nodeId: TreeNodeId, indent: string = "", isLast: boolean = true): string {
    const prefix = indent + (isLast ? "└── " : "├── ");
    let result = prefix + nodeId + "\n";

    let nodeName: string | null = null;

    if (nodeId !== null) {
      const node = this.getNode(nodeId);
      if (node) {
        for (const prop of node.getAllProperties()) {
          if (prop.key === "name") {
            nodeName = prop.value as string;
            //continue;
          }

          const propPrefix = indent + (isLast ? "    " : "│   ") + "• ";
          result += `${propPrefix}${prop.key}: ${JSON.stringify(prop.value)}\n`;
        }
      }
    }

    // Get children and sort them for deterministic output
    const children = this.getChildrenIds(nodeId);
    const sortedChildren = [...children].sort((a, b) => {
      // Sort by name if available
      const nodeA = this.getNode(a);
      const nodeB = this.getNode(b);

      const nameA = nodeA?.getProperty('name') as string | undefined;
      const nameB = nodeB?.getProperty('name') as string | undefined;

      // If both have names, compare them
      if (nameA && nameB) {
        return nameA.localeCompare(nameB);
      }

      // If only one has a name, prioritize the one with a name
      if (nameA) return -1;
      if (nameB) return 1;

      // Fall back to sorting by ID for consistent output
      return a.localeCompare(b);
    });

    for (let i = 0; i < sortedChildren.length; i++) {
      const childId = sortedChildren[i];
      const isLastChild = i === sortedChildren.length - 1;
      result += this.printTree(childId, indent + (isLast ? "    " : "│   "), isLastChild);
    }

    return result;
  }
}
