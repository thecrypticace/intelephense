/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
const types_1 = require("./types");
const typeString_1 = require("./typeString");
const builtInSymbols = require("./builtInSymbols.json");
const symbolReader_1 = require("./symbolReader");
const nameResolver_1 = require("./nameResolver");
class SymbolTable {
    constructor(uri, root) {
        this.uri = uri;
        this.root = root;
    }
    get symbols() {
        let traverser = new types_1.TreeTraverser([this.root]);
        let symbols = traverser.toArray();
        //remove root
        symbols.shift();
        return symbols;
    }
    get count() {
        let traverser = new types_1.TreeTraverser([this.root]);
        //subtract 1 for root
        return traverser.count() - 1;
    }
    traverse(visitor) {
        let traverser = new types_1.TreeTraverser([this.root]);
        traverser.traverse(visitor);
        return visitor;
    }
    filter(predicate) {
        let traverser = new types_1.TreeTraverser([this.root]);
        return traverser.filter(predicate);
    }
    find(predicate) {
        let traverser = new types_1.TreeTraverser([this.root]);
        return traverser.find(predicate);
    }
    symbolAtPosition(position) {
        let pred = (x) => {
            return x.location &&
                x.location.range.start.line === position.line &&
                x.location.range.start.character === position.character;
        };
        return this.filter(pred).pop();
    }
    toDto() {
        return {
            uri: this.uri,
            root: this.traverse(new ToPhpSymbolDtoVisitor()).root
        };
    }
    static fromDto(dto) {
        let traverser = new types_1.TreeTraverser([dto.root]);
        let visitor = new ToPhpSymbolVisitor(dto.uri);
        traverser.traverse(visitor);
        return new SymbolTable(dto.uri, visitor.root);
    }
    static create(parsedDocument, externalOnly) {
        let symbolReader = symbolReader_1.SymbolReader.create(parsedDocument, new nameResolver_1.NameResolver(), [{ kind: 0 /* None */, name: '', children: [] }]);
        symbolReader.externalOnly = externalOnly;
        parsedDocument.traverse(symbolReader);
        return new SymbolTable(parsedDocument.uri, symbolReader.spine[0]);
    }
    static readBuiltInSymbols() {
        SymbolTable.builtInSymbolTypeStrings(builtInSymbols);
        return new SymbolTable('\\', {
            kind: 0 /* None */,
            name: '',
            children: builtInSymbols
        });
    }
    static builtInSymbolTypeStrings(symbols) {
        let s;
        for (let n = 0, l = symbols.length; n < l; ++n) {
            s = symbols[n];
            if (s.type) {
                s.type = new typeString_1.TypeString(s.type);
            }
            if (s.children) {
                SymbolTable.builtInSymbolTypeStrings(s.children);
            }
        }
    }
}
exports.SymbolTable = SymbolTable;
class SymbolStore {
    constructor() {
        this.onParsedDocumentChange = (args) => {
            this.remove(args.parsedDocument.uri);
            this.add(SymbolTable.create(args.parsedDocument));
        };
        this._map = {};
        this._index = new symbol_1.SymbolIndex();
        this._symbolCount = 0;
    }
    getSymbolTable(uri) {
        return this._map[uri];
    }
    get tableCount() {
        return Object.keys(this._map).length;
    }
    get symbolCount() {
        return this._symbolCount;
    }
    add(symbolTable) {
        if (this.getSymbolTable(symbolTable.uri)) {
            throw new Error(`Duplicate key ${symbolTable.uri}`);
        }
        this._map[symbolTable.uri] = symbolTable;
        this._index.addMany(this._indexSymbols(symbolTable.root));
        this._symbolCount += symbolTable.count;
    }
    remove(uri) {
        let symbolTable = this.getSymbolTable(uri);
        if (!symbolTable) {
            return;
        }
        this._index.removeMany(this._indexSymbols(symbolTable.root));
        this._symbolCount -= symbolTable.count;
        delete this._map[uri];
    }
    /**
     * As per match but returns first item in result that matches full text
     * the match is case sensitive for constants and variables and insensitive for
     * classes, traits, interfaces, functions, methods
     * @param text
     * @param filter
     */
    find(text, filter) {
        let lcText = text.toLowerCase();
        let kindMask = 8 /* Constant */ | 256 /* Variable */;
        let exactMatchFn = (x) => {
            return (!filter || filter(x)) &&
                (((x.kind & kindMask) > 0 && x.name === text) ||
                    (!(x.kind & kindMask) && x.name.toLowerCase() === lcText));
        };
        return this.match(text, exactMatchFn).shift();
    }
    /**
     * Matches any indexed symbol by name or partial name with optional additional filter
     * Parameters and variables that are not file scoped are not indexed.
     * case insensitive
     */
    match(text, filter, fuzzy) {
        if (!text) {
            return [];
        }
        let matched = this._index.match(text, fuzzy);
        if (!filter) {
            return matched;
        }
        let filtered = [];
        let s;
        for (let n = 0, l = matched.length; n < l; ++n) {
            s = matched[n];
            if (filter(s)) {
                filtered.push(s);
            }
        }
        return filtered;
    }
    _classOrInterfaceFilter(s) {
        return (s.kind & (1 /* Class */ | 2 /* Interface */)) > 0;
    }
    lookupTypeMembers(query) {
        let type = this.find(query.typeName, this._classOrInterfaceFilter);
        return this._lookupTypeMembers(type, query.memberPredicate, []);
    }
    lookupTypeMember(query) {
        return this.lookupTypeMembers(query).shift();
    }
    lookupMembersOnTypes(queries) {
        let symbols = [];
        for (let n = 0, l = queries.length; n < l; ++n) {
            Array.prototype.push.apply(symbols, this.lookupTypeMembers(queries[n]));
        }
        return symbols;
    }
    lookupMemberOnTypes(queries) {
        return this.lookupMembersOnTypes(queries).shift();
    }
    /**
     * This will return duplicate symbols where members are overridden or already implemented
     * @param type
     * @param predicate
     * @param typeHistory
     */
    _lookupTypeMembers(type, predicate, typeHistory) {
        if (!type || typeHistory.indexOf(type.name) > -1) {
            return [];
        }
        //prevent cyclical lookup
        typeHistory.push(type.name);
        let members = type.children ? type.children.filter(predicate) : [];
        if (!type.associated) {
            return members;
        }
        //lookup in base class/traits
        let baseMemberPredicate = (x) => {
            return predicate(x) && !(x.modifiers & 4 /* Private */);
        };
        let baseSymbol;
        let basePredicate;
        for (let n = 0, l = type.associated.length; n < l; ++n) {
            baseSymbol = type.associated[n]; //stub symbol
            basePredicate = (x) => {
                return x.kind === baseSymbol.kind;
            };
            baseSymbol = this.find(baseSymbol.name, basePredicate);
            if (baseSymbol) {
                Array.prototype.push.apply(members, this._lookupTypeMembers(baseSymbol, baseMemberPredicate, typeHistory));
            }
        }
        return members;
    }
    _indexSymbols(root) {
        let traverser = new types_1.TreeTraverser([root]);
        return traverser.filter(this._indexFilter);
    }
    _indexFilter(s) {
        return s.kind !== 128 /* Parameter */ &&
            (s.kind !== 256 /* Variable */ || !s.scope) &&
            !(s.modifiers & 4096 /* Use */) &&
            s.name.length > 0;
    }
}
exports.SymbolStore = SymbolStore;
class ToPhpSymbolDtoVisitor {
    constructor() {
        this._dtoStack = [];
    }
    get root() {
        return this._dtoStack.length ? this._dtoStack[0] : null;
    }
    preorder(node, spine) {
        let parent = this._dtoStack.length ? this._dtoStack[this._dtoStack.length - 1] : null;
        let dto = {
            kind: node.kind,
            name: node.name
        };
        if (node.modifiers) {
            dto.modifiers = node.modifiers;
        }
        if (node.location) {
            dto.location = this._rangeToArray(node.location.range);
        }
        if (node.associated) {
            dto.associated = this._associatedToAssociatedDto(node.associated);
        }
        if (node.description) {
            dto.description = node.description;
        }
        if (node.scope) {
            dto.scope = node.scope;
        }
        if (node.value) {
            dto.value = node.value;
        }
        if (node.typeSource) {
            dto.typeSource = node.typeSource;
        }
        if (node.type) {
            dto.type = node.type.toString();
        }
        if (parent) {
            if (!parent.children) {
                parent.children = [];
            }
            parent.children.push(dto);
        }
        this._dtoStack.push(dto);
        return true;
    }
    postorder(node, spine) {
        if (this._dtoStack.length > 1) {
            this._dtoStack.pop();
        }
    }
    _rangeToArray(range) {
        return [
            range.start.line,
            range.start.character,
            range.end.line,
            range.end.character
        ];
    }
    _associatedToAssociatedDto(associated) {
        let dtos = [];
        let s;
        for (let n = 0, l = associated.length; n < l; ++n) {
            s = associated[n];
            dtos.push({
                kind: s.kind,
                name: s.name
            });
        }
        return dtos;
    }
}
class ToPhpSymbolVisitor {
    constructor(uri) {
        this.uri = uri;
        this._symbolStack = [];
    }
    get root() {
        return this._symbolStack.length ? this._symbolStack[0] : null;
    }
    preorder(node, spine) {
        let parent = this._symbolStack.length ? this._symbolStack[this._symbolStack.length - 1] : null;
        let s = {
            kind: node.kind,
            name: node.name
        };
        if (node.modifiers) {
            s.modifiers = node.modifiers;
        }
        if (node.location) {
            s.location = this._arrayToLocation(this.uri, node.location);
        }
        if (node.associated) {
            s.associated = this._associatedDtoToAssociated(node.associated);
        }
        if (node.description) {
            s.description = node.description;
        }
        if (node.scope) {
            s.scope = node.scope;
        }
        if (node.value) {
            s.value = node.value;
        }
        if (node.typeSource) {
            s.typeSource = node.typeSource;
        }
        if (node.type) {
            s.type = new typeString_1.TypeString(node.type);
        }
        if (parent) {
            if (!parent.children) {
                parent.children = [];
            }
            parent.children.push(s);
        }
        this._symbolStack.push(s);
        return true;
    }
    postorder(node, spine) {
        if (this._symbolStack.length > 1) {
            this._symbolStack.pop();
        }
    }
    _associatedDtoToAssociated(associatedDto) {
        let associated = [];
        let dto;
        for (let n = 0, l = associatedDto.length; n < l; ++n) {
            dto = associatedDto[n];
            associated.push({
                kind: dto.kind,
                name: dto.name
            });
        }
        return associated;
    }
    _arrayToLocation(uri, array) {
        return {
            uri: uri,
            range: {
                start: {
                    line: array[0],
                    character: array[1]
                },
                end: {
                    line: array[2],
                    character: array[3]
                }
            }
        };
    }
}
