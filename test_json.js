const rules = [
  {
    id: "rule_1",
    name: "test",
    enabled: true,
    type: "sensor",
    action: { type: "modbus_relay", actuator_id: "1", slave_id: 1, fc: 5, register: 0, command: 65280 },
    cooldown_ms: 10000,
    last_fired_ms: 0,
    conditions: [{ source: "modbus", sensor_id: "1", operator: ">", value: 20 }],
    logic: "AND"
  }
];
console.log(JSON.stringify({ enabled: true, rules: rules }));
