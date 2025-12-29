export async function execConsoleMuted(f: () => Promise<void>) {
    try {
        console.log = () => {
        };
        console.error = () => {
        };
        console.warn = () => {
        };

        await f();
    }
    finally {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
    }
}

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
