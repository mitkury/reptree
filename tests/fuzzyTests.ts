import { RepTree } from "../dist/index.js";

type RandomAction = 'move' | 'create' | 'setProperty';

export function fuzzyTest(treesCount: number = 3, tries: number = 10, movesPerTry: number = 1000, randomShuffle: boolean = false): RepTree[] {
  if (treesCount < 2) {
    throw new Error("treesCount must be at least 2");
  }

  const trees: RepTree[] = [];

  trees[0] = new RepTree("peer1");
  for (let i = 1; i < treesCount; i++) {
    trees[i] = new RepTree(`peer${i + 1}`, trees[0].getMoveOps());
  }

  for (let i = 0; i < tries; i++) {
    console.log(`🧪 Starting try ${i + 1}...`);

    randomMovesAndProps(trees, movesPerTry);

    // Check if all trees have the same structure
    console.log(`Verifying trees have the same structure...`);
    for (let j = 1; j < treesCount; j++) {
      if (!trees[0].compareStructure(trees[j])) {
        console.error(`❌ Tree ${j + 1} has a different structure from Tree 1`);
        return trees;
      }
    }
    console.log(`✅ All trees have the same structure after try ${i + 1}`);
  }

  console.log(`🏁 All trees synced successfully after ${tries} tries`);

  return trees;
}

function randomMovesAndProps(trees: RepTree[], maxMoves: number = 1000): void {
  const treeCount = trees.length;

  for (let i = 0; i < maxMoves; i++) {
    // Pick a random tree to make a change
    const treeIndex = Math.floor(Math.random() * treeCount);
    const tree = trees[treeIndex];

    // Pick a random action
    const actionType = pickRandomAction();

    // Execute the action
    executeRandomAction(tree, actionType);

    // Sync the change to other trees
    const ops = tree.getAllOps();
    for (let j = 0; j < treeCount; j++) {
      if (j !== treeIndex) {
        trees[j].merge(ops);
      }
    }
  }
}

function pickRandomAction(): RandomAction {
  const actions: RandomAction[] = ['move', 'create', 'setProperty'];
  const index = Math.floor(Math.random() * actions.length);
  return actions[index];
}

function executeRandomAction(tree: RepTree, actionType: RandomAction): void {
  const vertices = tree.getAllVertices();
  
  if (vertices.length === 0) {
    // If no vertices, we can only create
    const rootVertex = tree.rootVertex;
    tree.newVertex(rootVertex.id);
    return;
  }

  // Pick a random vertex
  const vertexIndex = Math.floor(Math.random() * vertices.length);
  const vertex = vertices[vertexIndex];

  switch (actionType) {
    case 'create':
      tree.newVertex(vertex.id);
      break;
    
    case 'move':
      if (vertices.length > 1) {
        // Pick another random vertex that's not the same one
        let targetIndex;
        do {
          targetIndex = Math.floor(Math.random() * vertices.length);
        } while (targetIndex === vertexIndex);
        
        const targetVertex = vertices[targetIndex];
        
        // Don't move if it would create a cycle or if it's the root
        if (!tree.isAncestor(targetVertex.id, vertex.id) && vertex.id !== tree.rootVertex.id) {
          tree.moveVertex(vertex.id, targetVertex.id);
        }
      }
      break;
    
    case 'setProperty':
      const propName = `prop_${Math.floor(Math.random() * 10)}`;
      const propValue = `value_${Math.floor(Math.random() * 100)}`;
      tree.setVertexProperty(vertex.id, propName, propValue);
      break;
  }
} 