/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { SymbolStore, NameResolver, PhpSymbol, SymbolKind, SymbolModifier } from './symbol';
import { TreeVisitor, TreeTraverser } from './types';
import { ParsedDocument } from './parsedDocument';
import { Position } from 'vscode-languageserver-types';
import { Phrase, Token, PhraseType, NamespaceDefinition } from 'php7parser';

class ContextVisitor implements TreeVisitor<Phrase | Token>{

    haltTraverse: boolean;

    private _spine: (Phrase | Token)[];
    private _namespaceDefinition: NamespaceDefinition;

    constructor(public offset) {
        this.haltTraverse = false;
    }

    get spine() {
        return this._spine;
    }

    get namespaceDefinition() {
        return this._namespaceDefinition;
    }

    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (this.haltTraverse) {
            return false;
        }

        if (ParsedDocument.isOffsetInToken(this.offset, <Token>node)) {
            this.haltTraverse = true;
            this._spine = spine.slice(0);
            this._spine.push(node);
            return false;
        }

        if ((<Phrase>node).phraseType === PhraseType.NamespaceDefinition) {
            this._namespaceDefinition = <NamespaceDefinition>node;
        }

        return true;

    }

    postOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (this.haltTraverse) {
            return;
        }

        if ((<Phrase>node).phraseType === PhraseType.NamespaceDefinition &&
            (<NamespaceDefinition>node).statementList) {
            this._namespaceDefinition = undefined;
        }
    }


}

export class Context {

    private _nameResolver: NameResolver;
    private _spine: (Phrase | Token)[];
    private _offset: number;

    constructor(spine: (Phrase | Token)[], nameResolver: NameResolver, offset: number) {
        this._nameResolver = nameResolver;
        this._spine = spine.slice(0);
        this._offset = offset;
    }

    get offset() {
        return this._offset;
    }

    get spine() {
        return this._spine.slice(0);
    }

    get nameResolver() {
        return this._nameResolver;
    }

    createTraverser() {
        return new TreeTraverser(this._spine);
    }

    static create(symbolStore: SymbolStore, document: ParsedDocument, position: Position) {

        let offset = document.offsetAtPosition(position);
        let contextVisitor = new ContextVisitor(offset);
        document.traverse(contextVisitor);
        let namespaceDefinition = contextVisitor.namespaceDefinition;
        let spine = contextVisitor.spine;
        let namespaceName = namespaceDefinition ? document.namespaceNameToString(namespaceDefinition.name) : '';
        
        let importFilter = (s: PhpSymbol) => {
            return (s.modifiers & SymbolModifier.Use) > 0 &&
                (s.kind & (SymbolKind.Class | SymbolKind.Constant | SymbolKind.Function)) > 0
        };

        let symbolTable = symbolStore.getSymbolTable(document.uri);
        let imported = symbolTable ? symbolTable.filter(importFilter) : [];
        let thisName = '';
        let baseName = '';

        let nameResolver = new NameResolver(document, imported, namespaceName, thisName, baseName);
        return new Context(spine, nameResolver, offset);

    }

}

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