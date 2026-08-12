// Fixture: cog.name disagrees with its directory, and the command has no execute.
export default {
    name: "not-mismatched",
    description: "fixture",
    commands: [{ data: { name: "broken" } }],
    events: [{ name: "someEvent" }],
};
