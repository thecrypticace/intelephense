/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { PhpSymbol, SymbolKind } from './symbol';
import {SymbolStore, MemberQuery} from './symbolStore';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Context } from './context';
import {
    Phrase, PhraseType, Token, MemberName, ScopedMemberName, TokenType,
    ScopedExpression, ObjectAccessExpression, SimpleVariable
} from 'php7parser';
import { TreeTraverser } from './types';

export class DefinitionProvider {

    constructor(public symbolStore: SymbolStore, public documentStore: ParsedDocumentStore) { }

    provideDefinition(uri: string, position: lsp.Position) {

        let doc = this.documentStore.find(uri);
        if (!doc) {
            return null;
        }

        let context = new Context(this.symbolStore, doc, position);
        let traverser = context.createTraverser();
        let phrase: Phrase;
        let symbol: PhpSymbol;
        let name: string;

        while (phrase = <Phrase>traverser.parent()) {

            symbol = this._lookupSymbol(traverser.clone(), context);
            if (symbol) {
                break;
            }

        }

        return symbol && symbol.location ? symbol.location : null;


    }

    private _lookupSymbol(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let phrase = traverser.node as Phrase;
        switch (phrase.phraseType) {
            case PhraseType.SimpleVariable:
                return this._simpleVariable(traverser, context);
            case PhraseType.ScopedMemberName:
                return this._scopedMemberName(traverser, context);
            case PhraseType.MemberName:
                return this._memberName(traverser, context);
            case PhraseType.NamespaceName:
                return this._namespaceName(traverser, context);
            default:
                return null;

        }

    }

    private _isConstFuncClassTraitInterface(s: PhpSymbol) {

        switch (s.kind) {
            case SymbolKind.Class:
            case SymbolKind.Trait:
            case SymbolKind.Interface:
            case SymbolKind.Constant:
            case SymbolKind.Function:
                return s.location !== undefined && s.location !== null;
            default:
                return false;
        }

    }

    private _namespaceName(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let t2 = traverser.clone();
        if (this._isNamePhrase(t2.parent())) {
            return this._qualifiedName(t2, context);
        }

        //probably namespace use decl
        return this.symbolStore.find(context.nodeText(traverser.node, [TokenType.Whitespace]), this._isConstFuncClassTraitInterface);


    }

    private _qualifiedName(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let kind = SymbolKind.Class;
        let phrase = traverser.node as Phrase
        let parent = traverser.parent();

        if (ParsedDocument.isPhrase(parent, [PhraseType.ConstantAccessExpression])) {
            kind = SymbolKind.Constant;
        } else if (ParsedDocument.isPhrase(parent, [PhraseType.FunctionCallExpression])) {
            kind = SymbolKind.Function;
        }

        let name = context.resolveFqn(phrase, kind);
        return this.symbolStore.find(name, this._isConstFuncClassTraitInterface);

    }

    private _scopedMemberName(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let memberNamePhrase = traverser.node as ScopedMemberName;
        if (!ParsedDocument.isPhrase(memberNamePhrase.name, [PhraseType.Identifier]) &&
            !ParsedDocument.isToken(memberNamePhrase.name, [TokenType.VariableName])) {
            return null;
        }
        let parent = traverser.parent() as ScopedExpression;
        let memberName = context.nodeText(memberNamePhrase.name);
        let typeNames = context.resolveExpressionType(<Phrase>parent.scope).atomicClassArray();
        let pred = (x: PhpSymbol) => {
            return memberName === x.name && !!x.location;
        };
        let queries = typeNames.map<MemberQuery>((x) => {
            return { typeName: x, memberPredicate: pred };
        });
        return this.symbolStore.lookupMemberOnTypes(queries);

    }

    private _memberName(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let memberNamePhrase = traverser.node as MemberName;
        if (!ParsedDocument.isToken(memberNamePhrase.name, [TokenType.Name])) {
            return null;
        }
        let parent = traverser.parent() as ObjectAccessExpression;
        let memberName = context.tokenText(<Token>memberNamePhrase.name);
        let typeNames = context.resolveExpressionType(<Phrase>parent.variable).atomicClassArray();

        if(parent.phraseType === PhraseType.PropertyAccessExpression){
            memberName = '$' + memberName;
        }

        let pred = (x: PhpSymbol) => {
            return memberName === x.name && !!x.location;
        };
        let queries = typeNames.map<MemberQuery>((x) => {
            return { typeName: x, memberPredicate: pred };
        });
        return this.symbolStore.lookupMemberOnTypes(queries);

    }

    private _simpleVariable(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let phrase = traverser.node as SimpleVariable;
        if (!ParsedDocument.isToken(phrase.name, [TokenType.VariableName])) {
            return null;
        }

        let varName = context.tokenText(<Token>phrase.name);
        let scopeSymbol = context.scopeSymbol;
        let pred = (x: PhpSymbol) => {
            return x.name === varName;
        };
        return scopeSymbol.children.find(pred);

    }

    private _isNamePhrase(node: Phrase | Token) {

        if (!node) {
            return false;
        }

        switch ((<Phrase>node).phraseType) {
            case PhraseType.QualifiedName:
            case PhraseType.FullyQualifiedName:
            case PhraseType.RelativeQualifiedName:
                return true;
            default:
                return false;
        }

    }

}