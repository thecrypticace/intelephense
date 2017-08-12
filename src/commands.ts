/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {Position, TextEdit} from 'vscode-languageserver-types';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { ParseTreeTraverser } from './parseTreeTraverser';
import { SymbolStore, SymbolTable } from './symbolStore';
import { SymbolKind, PhpSymbol, Reference } from './symbol';
import { ReferenceReader } from './referenceReader';
import { NameResolver } from './nameResolver';
import { Phrase, PhraseType, Token } from 'php7parser';
import {UseDeclarationHelper} from './useDeclarationHelper';
import * as util from './util';

export class NameTextEditProvider {

    constructor(public symbolStore:SymbolStore, public docStore:ParsedDocumentStore) {

    }

    provideContractFqnTextEdits(uri:string, position:Position, alias?:string) {

        let edits:TextEdit[] = [];
        let doc = this.docStore.find(uri);
        let table = this.symbolStore.getSymbolTable(uri);

        if(!doc) {
            return edits;
        }

        let fqnNode = this._fullyQualifiedNamePhrase(position, doc, table);
        let symbol = this.symbolStore.find(doc.nodeText(fqnNode)).shift();

        if(!symbol) {
            return edits;
        }

        let helper = new UseDeclarationHelper(doc, table, position);
        let fqnUseSymbol = helper.findUseSymbolByFqn(symbol.name);
        let nameUseSymbol = helper.findUseSymbolByName(PhpSymbol.notFqn(symbol.name));

        if (!fqnUseSymbol){
            if(!alias && nameUseSymbol) {
                //declaration will clash with an existing import
                return edits;
            }

            edits.push(helper.insertDeclarationTextEdit(symbol, alias));

        } else if(alias && fqnUseSymbol.name !== alias) {
            //replace existing 
            edits.push(helper.replaceDeclarationTextEdit(symbol, alias));
        }

        let name = alias || PhpSymbol.notFqn(symbol.name);
        const kindMask = SymbolKind.Class | SymbolKind.Interface | SymbolKind.Trait | SymbolKind.Function | SymbolKind.Constant | SymbolKind.Constructor;
        let lcName = symbol.name.toLowerCase();

        let fn = (r:Reference) => {
            return (r.kind & kindMask) > 0 && lcName === r.name.toLowerCase();
        };

        let references = table.references(fn);

        for (let n = 0, l = references.length; n < l; ++n) {
            edits.push(TextEdit.replace(references[n].location.range, name));
        }
    
        return edits.reverse();

    }

    private _fullyQualifiedNamePhrase(position:Position, doc:ParsedDocument, table:SymbolTable) {
        let traverser = new ParseTreeTraverser(doc, table);
        traverser.position(position);
        let fqnNode = traverser.ancestor(this._isFullyQualifiedName);
        if(!fqnNode && position.character > 0) {
            traverser.position(Position.create(position.line, position.character - 1));
            return traverser.ancestor(this._isFullyQualifiedName);
        } else {
            return fqnNode;
        }
    } 

    private _isFullyQualifiedName(node:Phrase|Token) {
        return (<Phrase>node).phraseType === PhraseType.FullyQualifiedName;        
    }

}
