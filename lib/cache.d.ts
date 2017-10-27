export interface Cache {
    init(): Promise<void>;
    read(key: string): Promise<any>;
    write(key: string, data: any): Promise<void>;
    delete(key: string): Promise<void>;
}
export declare function createCache(path: string): FileCache;
export declare class FileCache implements Cache {
    private path;
    constructor(path: string);
    init(): Promise<void>;
    read(key: string): Promise<any>;
    write(key: string, data: any): Promise<void>;
    delete(key: string): Promise<void>;
    private _filePath(key);
}
