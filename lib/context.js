/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
const types_1 = require("./types");
const parsedDocument_1 = require("./parsedDocument");
class ContextVisitor {
    constructor(offset) {
        this.offset = offset;
        this.haltTraverse = false;
    }
    get spine() {
        return this._spine;
    }
    get namespaceDefinition() {
        return this._namespaceDefinition;
    }
    preOrder(node, spine) {
        if (this.haltTraverse) {
            return false;
        }
        if (parsedDocument_1.ParsedDocument.isOffsetInToken(this.offset, node)) {
            this.haltTraverse = true;
            this._spine = spine.slice(0);
            this._spine.push(node);
            return false;
        }
        if (node.phraseType === 118 /* NamespaceDefinition */) {
            this._namespaceDefinition = node;
        }
        return true;
    }
    postOrder(node, spine) {
        if (this.haltTraverse) {
            return;
        }
        if (node.phraseType === 118 /* NamespaceDefinition */ &&
            node.statementList) {
            this._namespaceDefinition = undefined;
        }
    }
}
class Context {
    constructor(symbolStore, document, position) {
        this.symbolStore = symbolStore;
        this.document = document;
        this.position = position;
        this._offset = document.offsetAtPosition(position);
        let contextVisitor = new ContextVisitor(this._offset);
        document.traverse(contextVisitor);
        this._namespaceDefinition = contextVisitor.namespaceDefinition;
        this._parseTreeSpine = contextVisitor.spine;
    }
    get token() {
        return this._parseTreeSpine.length ? this._parseTreeSpine[this._parseTreeSpine.length - 1] : null;
    }
    get offset() {
        return this.document.offsetAtPosition(this.position);
    }
    get spine() {
        return this._parseTreeSpine.slice(0);
    }
    get scopePhrase() {
        if (!this._scopePhrase) {
            let t = this.createTraverser();
            //need to get scope body first to exclude chance 
            //that position is within a scope declaration
            t.ancestor(this._isScopeBody);
            this._scopePhrase = t.ancestor(this._isScopePhrase);
            if (!this._scopePhrase) {
                this._scopePhrase = this._parseTreeSpine[0];
            }
        }
        return this._scopePhrase;
    }
    get scopeSymbol() {
        if (!this._scopeSymbol) {
            let phrase = this.scopePhrase;
            let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
            let phrasePos = this.document.phraseRange(phrase).start;
            this._scopeSymbol = symbolTable.find((x) => {
                return x.location &&
                    x.location.range.start.line === phrasePos.line &&
                    x.location.range.start.character === phrasePos.character;
            });
            if (!this._scopeSymbol) {
                this._scopeSymbol = symbolTable.root;
            }
        }
        return this._scopeSymbol;
    }
    createNameResolver() {
        let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
        let imported = symbolTable ? symbolTable.filter(this._importFilter) : [];
        let namespaceName = this._namespaceDefinition ?
            this.document.namespaceNameToString(this._namespaceDefinition.name) : '';
        let thisName = '';
        let baseName = '';
        return new symbol_1.NameResolver(this.document, imported, namespaceName, thisName, baseName);
    }
    createTraverser() {
        return new types_1.TreeTraverser(this._parseTreeSpine);
    }
    _isScopePhrase(p) {
        switch (p.phraseType) {
            case 85 /* FunctionDeclaration */:
            case 111 /* MethodDeclaration */:
            case 4 /* AnonymousFunctionCreationExpression */:
            case 28 /* ClassDeclaration */:
            case 101 /* InterfaceDeclaration */:
            case 163 /* TraitDeclaration */:
            case 2 /* AnonymousClassDeclaration */:
                return true;
            default:
                return false;
        }
    }
    _isScopeBody(p) {
        switch (p.phraseType) {
            case 39 /* CompoundStatement */:
            case 32 /* ClassMemberDeclarationList */:
            case 104 /* InterfaceMemberDeclarationList */:
            case 166 /* TraitMemberDeclarationList */:
                return true;
            default:
                return false;
        }
    }
    _importFilter(s) {
        return (s.modifiers & 4096 /* Use */) > 0 &&
            (s.kind & (1 /* Class */ | 8 /* Constant */ | 64 /* Function */)) > 0;
    }
}
exports.Context = Context;
/*

private _tokenIndex: number;
private _token: Token;
private _phraseNode: Tree<Phrase | Token>;
private _scopeNode: Tree<Phrase | Token>;
private _concreteScopeNode: Tree<Phrase | Token>;
private _thisNode: Tree<Phrase | Token>;
private _namespaceNode: Tree<Phrase | Token>;

constructor(public position: Position,
    public parsedDoc: ParsedDocument,
    public symbolStore: SymbolStore) {
    let visitor = new AstContextVisitor(this.position);
    this.parsedDoc.parseTree.traverse(visitor);
    this._phraseNode = visitor.phraseNode;
    this._scopeNode = visitor.scopeNode;
    this._namespaceNode = visitor.namespaceNode;
    this._thisNode = visitor.thisNode;
    this._concreteScopeNode = visitor.concreteScopeNode;
}

get token() {
    return this.parsedDoc.tokens[this.tokenIndex];
}

get phraseNode() {
    return this._phraseNode;
}

get scopeNode() {
    return this._scopeNode;
}

get concreteScopeNode() {
    return this._concreteScopeNode;
}

get tokenIndex() {
    if (this._tokenIndex === undefined) {
        this._tokenIndex = this.parsedDoc.tokenIndexAtPosition(this.position);
    }
    return this._tokenIndex;
}

get namespaceNode() {
    return this._namespaceNode;
}

get thisNode() {
    return this._thisNode;
}

get namespaceName() {
    return this._namespaceNode ? namespaceNodeToString(this._namespaceNode) : '';
}

get thisName() {
    if (!this._thisNode) {
        return '';
    }

    let thisName: string
    if ((<Phrase>this._thisNode.value).phraseType === PhraseType.AnonymousClassDeclaration) {
        thisName = anonymousName(this._thisNode);
    } else {
        thisName = tokenNodeToString(this._thisNode.children[0]);
        let nsName = this.namespaceName;
        if (thisName && nsName) {
            thisName = nsName + '\\' + thisName;
        }
    }

    return thisName;

}

get thisExtendsName() {
    let thisNode = this.thisNode;
    if(!thisNode || (<Phrase>thisNode.value).phraseType !== PhraseType.ClassDeclaration){
        return '';
    }

    let docSymbols = this.symbolStore.getSymbolTable(this.parsedDoc.uri);
    let nameResolver = new NameResolver(docSymbols.importTable);
    nameResolver.namespace = this.namespaceName;
    return nameNodeToFqnString(thisNode.children[2], nameResolver, SymbolKind.Class);

}

typeResolveExpression(node: Tree<Phrase | Token>) {

    let docSymbols = this.symbolStore.getSymbolTable(this.parsedDoc.uri);
    let nameResolver = new NameResolver(docSymbols.importTable);
    nameResolver.namespace = this.namespaceName;
    nameResolver.thisName = this.thisName;
    let exprTypeResolver = new ExpressionTypeResolver(nameResolver, this.symbolStore, this.typeResolveVariable);
    node.traverse(exprTypeResolver);
    return exprTypeResolver.type;

}

typeResolveVariable = (varNode: Tree<Phrase|Token>) => {

    let docSymbols = this.symbolStore.getSymbolTable(this.parsedDoc.uri);
    let nameResolver = new NameResolver(docSymbols.importTable);
    nameResolver.namespace = this.namespaceName;
    nameResolver.thisName = this.thisName;
    let varName = variableNodeToString(varNode);
    
    if (!varName) {
        return null;
    } else if (varName === '$this') {
        return new TypeString(nameResolver.thisName);
    } else {

        let varTable = new VariableTable();
        if (nameResolver.thisName) {
            varTable.pushThisType(new TypeString(nameResolver.thisName));
        }
        let varTypeResolver = new VariableTypeResolver(varTable, nameResolver,
            this.symbolStore, new ExpressionTypeResolver(nameResolver, this.symbolStore, this.typeResolveVariable),
            varNode, varName);

        this._concreteScopeNode.traverse(varTypeResolver);
        return varTypeResolver.variableTable.getType(varName);

    }

}

}
*/ 
