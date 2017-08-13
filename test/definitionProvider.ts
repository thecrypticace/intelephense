import { DefinitionProvider } from '../src/definitionProvider';
import { SymbolStore, SymbolTable } from '../src/symbolStore';
import { ParsedDocumentStore, ParsedDocument } from '../src/parsedDocument';
import { ReferenceReader } from '../src/referenceReader';
import * as lsp from 'vscode-languageserver-types';
import { assert } from 'chai';
import 'mocha';


function setup(src:string){

    let symbolStore = new SymbolStore();
    let doc = new ParsedDocument('test', src);
    let table = SymbolTable.create(doc);
    let docStore = new ParsedDocumentStore();
    docStore.add(doc);
    symbolStore.add(table);
    ReferenceReader.discoverReferences(doc, table, symbolStore);
    symbolStore.indexReferences(table);

    return new DefinitionProvider(symbolStore,docStore);

}

let objectAccessSrc =
`<?php
    class Test {
        public $foo;
        function bar(){}
    }
    $var = new Test();
    $var->bar();
    $var->foo;
`;

let scopedAccessSrc = 
`<?php
    class Test {
        const FOO = 1;
        static public $bar;
        static function baz(){}
    }
    Test::FOO;
    Test::$bar;
    Test::baz();
`;

let nameSrc = 
`<?php
    namespace Foo;
    function fn(){}
    fn();
`;

describe('DefintionProvider', function(){

    describe('#provideDefinition', function(){

        describe('Object access expr', function(){

            let provider:DefinitionProvider
            before(function(){
                provider = setup(objectAccessSrc);
            }); 

            it('method location', function(){
                let loc = provider.provideDefinition('test', {line:6, character:12});
                let expected:lsp.Location = {
                    uri:'test',
                    range:{
                        start:{line:3, character:8},
                        end:{line:3, character:24}
                    }
                } 
                assert.deepEqual(loc, expected);
                //console.log(JSON.stringify(loc, null, 4));
            });

            it('property location', function(){
                let loc = provider.provideDefinition('test', {line:7, character:12});
                let expected:lsp.Location = {
                    uri:'test',
                    range:{
                        start:{line:2, character:15},
                        end:{line:2, character:19}
                    }
                } 
                assert.deepEqual(loc, expected);
                //console.log(JSON.stringify(loc, null, 4));
            });

        });

        describe('Scoped access expr', function(){

            let provider:DefinitionProvider
            before(function(){
                provider = setup(scopedAccessSrc);
            }); 

            it('method location', function(){
                let loc = provider.provideDefinition('test', {line:8, character:12});
                let expected:lsp.Location = {
                    uri:'test',
                    range:{
                        start:{line:4, character:8},
                        end:{line:4, character:31}
                    }
                } 
                assert.deepEqual(loc, expected);
                //console.log(JSON.stringify(loc, null, 4));
            });

            it('property location', function(){
                let loc = provider.provideDefinition('test', {line:7, character:12});
                let expected:lsp.Location = {
                    uri:'test',
                    range:{
                        start:{line:3, character:22},
                        end:{line:3, character:26}
                    }
                } 
                assert.deepEqual(loc, expected);
                //console.log(JSON.stringify(loc, null, 4));
            });

            it('const location', function(){
                let loc = provider.provideDefinition('test', {line:6, character:12});
                let expected:lsp.Location = {
                    uri:'test',
                    range:{
                        start:{line:2, character:14},
                        end:{line:2, character:21}
                    }
                } 
                assert.deepEqual(loc, expected);
                //console.log(JSON.stringify(loc, null, 4));
            });

        });

        describe('Name', function(){

            let provider:DefinitionProvider
            before(function(){
                provider = setup(nameSrc);
            }); 

            it('function', function(){
                let loc = provider.provideDefinition('test', {line:3, character:5});
                let expected:lsp.Location = {
                    uri:'test',
                    range:{
                        start:{line:2, character:4},
                        end:{line:2, character:19}
                    }
                } 
                assert.deepEqual(loc, expected);
                //console.log(JSON.stringify(loc, null, 4));
            });

        });

    });



});