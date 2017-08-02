/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { PhpSymbol, SymbolKind, SymbolModifier, Reference } from './symbol';
import { SymbolStore, SymbolTable } from './symbolStore';
import { ExpressionTypeResolver, VariableTable, VariableTypeResolver } from './typeResolver';
import { NameResolver } from './nameResolver';
import { TreeVisitor, TreeTraverser, Predicate, MultiVisitor } from './types';
import { TypeString } from './typeString';
import { ParsedDocument } from './parsedDocument';
import { NameResolverVisitor } from './nameResolverVisitor';
import { Position, TextEdit, Range } from 'vscode-languageserver-types';
import {
    Phrase, Token, PhraseType, NamespaceDefinition, ClassDeclaration,
    TokenType, NamespaceUseDeclaration, InlineText, NamespaceName,
    FullyQualifiedName, QualifiedName, RelativeQualifiedName
} from 'php7parser';
import * as util from './util';

class ContextResolver extends MultiVisitor<Phrase | Token> {

    private _nameResolverVisitor: NameResolverVisitor;
    private _contextVisitor: ContextVisitor;

    constructor(nameResolverVisitor: NameResolverVisitor, contextVisitor: ContextVisitor) {
        super([nameResolverVisitor, contextVisitor]);
        this._nameResolverVisitor = nameResolverVisitor;
        this._contextVisitor = contextVisitor;
    }

    get nameResolver() {
        return this._nameResolverVisitor.nameResolver;
    }

    get spine() {
        return this._contextVisitor.spine;
    }

    get openingInlineText() {
        return this._contextVisitor.openingInlineText;
    }

    get lastNamespaceUseDeclaration() {
        return this._contextVisitor.lastNamespaceUseDeclaration;
    }

    get namespaceDefinition() {
        return this._contextVisitor.namespaceDefinition;
    }

    static create(document: ParsedDocument, nameResolver: NameResolver, offset: number) {
        return new ContextResolver(
            new NameResolverVisitor(document, nameResolver),
            new ContextVisitor(document, nameResolver, offset)
        );
    }

}

class ContextVisitor implements TreeVisitor<Phrase | Token> {

    private _spine: (Phrase | Token)[];
    private _openingInlineText: InlineText;
    private _lastNamespaceUseDeclaration: NamespaceUseDeclaration;
    private _namespaceDefinition: NamespaceDefinition;

    haltTraverse = false;
    haltAtOffset = -1;

    constructor(
        public document: ParsedDocument,
        public nameResolver: NameResolver,
        offset: number) {
        this.haltAtOffset = offset;
    }

    get spine() {
        return this._spine.slice(0);
    }

    get openingInlineText() {
        return this._openingInlineText;
    }

    get lastNamespaceUseDeclaration() {
        return this._lastNamespaceUseDeclaration;
    }

    get namespaceDefinition() {
        return this._namespaceDefinition;
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {
            case PhraseType.InlineText:
                if (!this._openingInlineText) {
                    this._openingInlineText = node as InlineText;
                }
                break;

            case PhraseType.NamespaceDefinition:
                this._namespaceDefinition = node as NamespaceDefinition;
                break;

            case PhraseType.NamespaceUseDeclaration:
                this._lastNamespaceUseDeclaration = node as NamespaceUseDeclaration;
                break;

            case undefined:
                //tokens
                if (this.haltAtOffset > -1 && ParsedDocument.isOffsetInToken(this.haltAtOffset, <Token>node)) {
                    this.haltTraverse = true;
                    this._spine = spine.slice(0);
                    this._spine.push(node);
                    return false;
                }

        }


        return true;

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (this.haltTraverse) {
            return;
        }

        switch ((<Phrase>node).phraseType) {

            case PhraseType.NamespaceDefinition:
                if ((<NamespaceDefinition>node).statementList) {
                    this._namespaceDefinition = null;
                }
                break;

            default:
                break;

        }

    }

}

export class Context {

    private _parseTreeSpine: (Phrase | Token)[];
    private _offset: number;
    private _namespaceDefinition: NamespaceDefinition;
    private _scopePhrase: Phrase;
    private _scopeSymbol: PhpSymbol;
    private _variableTable: VariableTable;
    private _thisPhrase: ClassDeclaration;
    private _thisSymbol: PhpSymbol;
    private _thisBaseSymbol: PhpSymbol;
    private _nameResolver: NameResolver;
    private _lastNamespaceUseDeclaration: NamespaceUseDeclaration;
    private _openingInlineText: InlineText;
    private _wordStartPosition: Position;

    constructor(
        public symbolStore: SymbolStore,
        public document: ParsedDocument,
        public position: Position
    ) {

        this._offset = document.offsetAtPosition(position) - 1;
        let contextVisitor = ContextResolver.create(this.document, new NameResolver(), this._offset);
        document.traverse(contextVisitor);
        this._parseTreeSpine = contextVisitor.spine;
        this._openingInlineText = contextVisitor.openingInlineText;
        this._nameResolver = contextVisitor.nameResolver;
        this._lastNamespaceUseDeclaration = contextVisitor.lastNamespaceUseDeclaration;
        this._namespaceDefinition = contextVisitor.namespaceDefinition;
    }

    get uri() {
        return this.document.uri;
    }

    get word() {
        return this.document.wordAtOffset(this._offset);
    }

    get wordStartPosition() {
        if (this._wordStartPosition === undefined) {
            let startOffset = this._offset - (this.word.length - 1);
            this._wordStartPosition = this.document.positionAtOffset(startOffset);
        }
        return this._wordStartPosition;
    }

    get token() {
        return this._parseTreeSpine.length ? <Token>this._parseTreeSpine[this._parseTreeSpine.length - 1] : null;
    }

    get offset() {
        return this.document.offsetAtPosition(this.position);
    }

    get spine() {
        return this._parseTreeSpine.slice(0);
    }

    get className() {
        return this._nameResolver.className;
    }

    get classBaseName() {
        return this._nameResolver.classBaseName;
    }

    get namespaceName() {
        return this._nameResolver.namespaceName;
    }

    get lastNamespaceUseDeclaration() {
        return this._lastNamespaceUseDeclaration;
    }

    get namespaceDefinition() {
        return this._namespaceDefinition;
    }

    get openingInlineText() {
        return this._openingInlineText;
    }

    get classDeclarationPhrase() {

        if (this._thisPhrase === undefined) {
            let traverser = this.createTraverser();
            this._thisPhrase = traverser.ancestor(this._isClassDeclaration) as ClassDeclaration;
        }
        return this._thisPhrase;

    }

    get classSymbol() {
        if (this._thisSymbol === undefined) {

            let phrase = this.classDeclarationPhrase;
            if (phrase) {
                let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
                let phrasePos = this.document.nodeRange(phrase).start;
                this._thisSymbol = symbolTable.symbolAtPosition(phrasePos);
            } else {
                this._thisSymbol = null;
            }

        }

        return this._thisSymbol;
    }

    get classBaseSymbol() {

        if (this._thisBaseSymbol === undefined) {

            let thisSymbol = this.classSymbol;
            if (!thisSymbol || !thisSymbol.associated) {
                this._thisBaseSymbol = null;
            } else {
                this._thisBaseSymbol = thisSymbol.associated.find((x) => {
                    return x.kind === SymbolKind.Class;
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
            this._scopePhrase = t.ancestor(this._isScopePhrase) as Phrase;
            if (!this._scopePhrase) {
                this._scopePhrase = this._parseTreeSpine[0] as Phrase;
            }
        }
        return this._scopePhrase;
    }

    get reference() {
        
    }

    get scopeSymbol() {

        if (!this._scopeSymbol) {

            let phrase = this.scopePhrase;
            let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
            let phrasePos = this.document.nodeRange(phrase).start;
            this._scopeSymbol = symbolTable.symbolAtPosition(phrasePos);

            if (!this._scopeSymbol) {
                this._scopeSymbol = symbolTable.root;
            }

        }

        return this._scopeSymbol;

    }

    get variableTable() {
        if (!this._variableTable) {
            let varTypeResolver = VariableTypeResolver.create(this.document, this.nameResolver, this.symbolStore, new VariableTable());
            varTypeResolver.haltAtOffset = this.token.offset;
            let t = this.createTraverser();
            let scope = t.ancestor(this._isAbsoluteScopePhrase);
            if (!scope) {
                scope = this._parseTreeSpine[0] as Phrase;
            }
            let traverser = new TreeTraverser([scope]);
            traverser.traverse(varTypeResolver);
            this._variableTable = varTypeResolver.variableTable;
        }
        return this._variableTable;

    }

    /**
     * Is declaration context if position is in name part of declaration only
     */
    isDeclaration() {

        let t = this.token;
        let traverser = this.createTraverser();
        let parent = traverser.parent() as Phrase;

        if(!t || !parent) {
            return false;
        }

        return ((t.tokenType === TokenType.Name || t.tokenType === TokenType.VariableName) && this._isDeclarationPhrase(parent)) ||
            (parent.phraseType === PhraseType.Identifier && this._isDeclarationPhrase(<Phrase>traverser.parent()));

    }

    private _isDeclarationPhrase(node:Phrase) {
        
        if(!node) {
            return false;
        }

        switch(node.phraseType) {
            case PhraseType.ClassDeclarationHeader:
            case PhraseType.TraitDeclarationHeader:
            case PhraseType.InterfaceDeclarationHeader:
            case PhraseType.PropertyElement:
            case PhraseType.ConstElement:
            case PhraseType.ParameterDeclaration:
            case PhraseType.FunctionDeclarationHeader:
            case PhraseType.MethodDeclarationHeader:
            case PhraseType.ClassConstElement:
                return true;
            default:
                return false;
        }
    }

    get symbolTable() {
        return this.symbolStore.getSymbolTable(this.document.uri);
    }

    get nameResolver() {
        return this._nameResolver;
    }

    textBefore(length: number) {
        return this.document.textBeforeOffset(this._offset, length);
    }

    tokenText(t: Token) {
        return this.document.tokenText(t);
    }

    nodeText(node: Phrase | Token, ignore?: TokenType[]) {
        return this.document.nodeText(node, ignore);
    }

    resolveFqn(phrase: Phrase, kind: SymbolKind) {
        if (!phrase) {
            return '';
        }

        switch (phrase.phraseType) {
            case PhraseType.QualifiedName:
                return this.nameResolver.resolveNotFullyQualified(this.document.namespaceNamePhraseToString((<QualifiedName>phrase).name), kind);
            case PhraseType.RelativeQualifiedName:
                return this.nameResolver.resolveRelative(this.document.namespaceNamePhraseToString((<RelativeQualifiedName>phrase).name));
            case PhraseType.FullyQualifiedName:
                return this.document.namespaceNamePhraseToString((<FullyQualifiedName>phrase).name);
            case PhraseType.NamespaceName:
                return this.document.namespaceNamePhraseToString(<NamespaceName>phrase);
            default:
                return '';
        }

    }

    resolveExpressionType(expr: Phrase) {
        let exprResolver = this.createExpressionTypeResolver();
        return exprResolver.resolveExpression(expr);
    }

    createTraverser() {
        return new TreeTraverser(this._parseTreeSpine);
    }

    createExpressionTypeResolver() {
        return new ExpressionTypeResolver(this.document, this._nameResolver, this.symbolStore, this.variableTable);
    }

    private _isAbsoluteScopePhrase(p: Phrase | Token) {
        switch ((<Phrase>p).phraseType) {
            case PhraseType.FunctionDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.ClassDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.AnonymousClassDeclaration:
                return true;
            default:
                return false;
        }
    }

    private _isScopePhrase(p: Phrase | Token) {
        switch ((<Phrase>p).phraseType) {
            case PhraseType.FunctionDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.ClassDeclaration:
            case PhraseType.AnonymousFunctionCreationExpression:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.AnonymousClassDeclaration:
                return true;
            default:
                return false;
        }
    }

    private _isScopeBody(p: Phrase | Token) {

        switch ((<Phrase>p).phraseType) {
            case PhraseType.FunctionDeclarationBody:
            case PhraseType.MethodDeclarationBody:
            case PhraseType.ClassMemberDeclarationList:
            case PhraseType.InterfaceMemberDeclarationList:
            case PhraseType.TraitMemberDeclarationList:
                return true;
            default:
                return false;
        }

    }

    private _importFilter(s: PhpSymbol) {
        return (s.modifiers & SymbolModifier.Use) > 0 &&
            (s.kind & (SymbolKind.Class | SymbolKind.Constant | SymbolKind.Function)) > 0;
    }

    private _isNamespaceDefinition(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceDefinition;
    }

    private _isClassDeclaration(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.ClassDeclaration;
    }

}

export class ParseTreeTraverser extends TreeTraverser<Phrase | Token> {

    private _doc: ParsedDocument;
    private _table:SymbolTable;

    constructor(document: ParsedDocument, symbolTable:SymbolTable) {
        super([document.tree]);
        this._doc = document;
        this._table = symbolTable;
    }

    get document() {
        return this._doc;
    }

    get symbolTable() {
        return this._table;
    }

    get text() {
        return this._doc.nodeText(this.node);
    }

    get range() {
        return this._doc.nodeRange(this.node);
    }

    get reference() {
        let scope = this.scope;
        let range = this.range;

        if(!scope || !range || !scope.references) {
            return null;
        }

        let ref:Reference;
        for(let n = 0; n < scope.references.length; ++n) {
            ref = scope.references[n];
            if(util.isInRange(range.start, ref.location.range) === 0) {
                return ref;
            }
        }

        return null;
    }

    get scope() {
        let range = this.range;
        if(!range) {
            return null;
        }
        return this._table.scope(range.start);
    }

    get nameResolver() {

    }

    position(pos: Position) {
        let offset = this._doc.offsetAtPosition(pos);
        let fn = (x: Phrase | Token) => {
            return (<Token>x).tokenType !== undefined &&
                offset < (<Token>x).offset + (<Token>x).length &&
                offset >= (<Token>x).offset;
        };

        return this.find(fn) as Token;
    }

    clone() {
        let spine = this.spine;
        let traverser = new ParseTreeTraverser(this._doc, this._table);
        traverser._spine = spine;
        return traverser;
    }

    /**
     * True if current node is the name part of a declaration
     */
    get isDeclarationName() {

        let traverser = this.clone();
        let t = traverser.node as Token;
        let parent = traverser.parent() as Phrase;

        if(!t || !parent) {
            return false;
        }

        return ((t.tokenType === TokenType.Name || t.tokenType === TokenType.VariableName) && this._isDeclarationPhrase(parent)) ||
            (parent.phraseType === PhraseType.Identifier && this._isDeclarationPhrase(<Phrase>traverser.parent()));

    }

    private _isDeclarationPhrase(node:Phrase) {
        
        if(!node) {
            return false;
        }

        switch(node.phraseType) {
            case PhraseType.ClassDeclarationHeader:
            case PhraseType.TraitDeclarationHeader:
            case PhraseType.InterfaceDeclarationHeader:
            case PhraseType.PropertyElement:
            case PhraseType.ConstElement:
            case PhraseType.ParameterDeclaration:
            case PhraseType.FunctionDeclarationHeader:
            case PhraseType.MethodDeclarationHeader:
            case PhraseType.ClassConstElement:
                return true;
            default:
                return false;
        }
    }

}
