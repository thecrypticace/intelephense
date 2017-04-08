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
    get word() {
        return this.document.wordAtOffset(this._offset);
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
    get thisName() {
        let s = this.thisSymbol;
        return s ? s.name : '';
    }
    get thisBaseName() {
        let s = this.thisBaseSymbol;
        return s ? s.name : '';
    }
    get namespaceName() {
        if (this._namespaceName === undefined) {
            if (this.namespacePhrase) {
                this._namespaceName = this.document.namespaceNameToString(this.namespacePhrase.name);
            }
            else {
                this._namespaceName = '';
            }
        }
        return this._namespaceName;
    }
    get namespacePhrase() {
        if (this._namespaceDefinition === undefined) {
            let traverser = this.createTraverser();
            let nsDef = traverser.ancestor(this._isNamespaceDefinition);
            if (!nsDef) {
                traverser.up(traverser.depth() - 2);
                while (nsDef = traverser.prevSibling()) {
                    if (this._isNamespaceDefinition(nsDef)) {
                        break;
                    }
                }
            }
            this._namespaceDefinition = nsDef;
        }
        return this._namespaceDefinition;
    }
    get thisPhrase() {
        if (this._thisPhrase === undefined) {
            let traverser = this.createTraverser();
            this._thisPhrase = traverser.ancestor(this._isClassDeclaration);
        }
        return this._thisPhrase;
    }
    get thisSymbol() {
        if (this._thisSymbol === undefined) {
            let phrase = this.thisPhrase;
            if (phrase) {
                let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
                let phrasePos = this.document.phraseRange(phrase).start;
                this._thisSymbol = symbolTable.symbolAtPosition(phrasePos);
            }
            else {
                this._thisSymbol = null;
            }
        }
        return this._thisSymbol;
    }
    get thisBaseSymbol() {
        if (this._thisBaseSymbol === undefined) {
            let thisSymbol = this.thisSymbol;
            if (!thisSymbol || !thisSymbol.associated) {
                this._thisBaseSymbol = null;
            }
            else {
                this._thisBaseSymbol = thisSymbol.associated.find((x) => {
                    return x.kind === 1 /* Class */;
                });
            }
        }
        return this._thisBaseSymbol;
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
            this._scopeSymbol = symbolTable.symbolAtPosition(phrasePos);
            if (!this._scopeSymbol) {
                this._scopeSymbol = symbolTable.root;
            }
        }
        return this._scopeSymbol;
    }
    get variableTable() {
        if (!this._variableTable) {
            let varTypeResolver = new symbol_1.VariableTypeResolver(new symbol_1.VariableTable(), this.document, this.createNameResolver(), this.symbolStore, this.token);
            let scope = this.scopePhrase;
            let traverser = new types_1.TreeTraverser([scope]);
            traverser.traverse(varTypeResolver);
            this._variableTable = varTypeResolver.variableTable;
        }
        return this._variableTable;
    }
    resolveExpressionType(expr) {
        let exprResolver = this.createExpressionTypeResolver();
        return exprResolver.resolveExpression(expr);
    }
    createNameResolver() {
        let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
        let imported = symbolTable ? symbolTable.filter(this._importFilter) : [];
        let namespaceName = this.namespaceName;
        let thisName = this.thisName;
        let baseName = this.thisBaseName;
        return new symbol_1.NameResolver(this.document, imported, namespaceName, thisName, baseName);
    }
    createTraverser() {
        return new types_1.TreeTraverser(this._parseTreeSpine);
    }
    createExpressionTypeResolver() {
        return new symbol_1.ExpressionTypeResolver(this.createNameResolver(), this.symbolStore, this.variableTable);
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
    _isNamespaceDefinition(node) {
        return node.phraseType === 118 /* NamespaceDefinition */;
    }
    _isClassDeclaration(node) {
        return node.phraseType === 28 /* ClassDeclaration */;
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
