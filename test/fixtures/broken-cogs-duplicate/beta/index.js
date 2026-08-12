// Fixture: claims /dupe as well. Loading both must fail, not silently pick one.
export default {
    name: "beta",
    description: "fixture",
    commands: [{ data: { name: "dupe" }, execute() {} }],
    events: [],
};
