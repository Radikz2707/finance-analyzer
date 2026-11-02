require("fs").appendFileSync(process.argv[2], process.argv[3], "utf8"); console.log("appended", process.argv[2]);
