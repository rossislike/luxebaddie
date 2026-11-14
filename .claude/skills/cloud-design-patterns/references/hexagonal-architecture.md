# Hexagonal Architecture (Ports and Adapters)

## Intent

Proposed by Alistair Cockburn in 2005. Create loosely coupled architectures where application components can be tested independently, with no dependency on data stores or UIs. Prevents technology lock-in of databases and UIs, so the stack can change over time with little or no impact on business logic. The application talks to the outside world through **ports** (interfaces) and uses **adapters** to translate technical exchanges.

## Motivation

Isolate business (domain) logic from infrastructure code such as database access and external API calls. Particularly useful for **AWS Lambda functions**, which often mix business logic and integration code.

Traditional architectures put business logic in stored procedures and in the UI, and let UI-specific constructs leak into business logic. That coupling creates bottlenecks for database migrations and UX modernization. Hexagonal architecture designs systems **by purpose rather than by technology**, so databases, UX, and service components become exchangeable.

## When to use

- You want to decouple the application so components can be fully tested.
- Multiple types of clients use the same domain logic.
- UI and database components need periodic technology refreshes that should not affect application logic.
- The application has multiple input providers and output consumers, and customizing logic per integration is creating complexity and blocking extensibility.

## When not to use

- A component with one fixed input, one fixed store, and no plans to change. The adapter code is justified only if there are several input sources or output destinations, or they will change over time. Otherwise it is just another layer to maintain.

## Issues and considerations

| Issue | Guidance |
|---|---|
| **Domain-driven design** | Works especially well with DDD: each application component represents a subdomain, and hexagons give loose coupling between them. |
| **Testability** | Inputs and outputs are abstractions, so unit tests in isolation are easy. |
| **Complexity** | Separating logic from infrastructure pays off in agility, coverage, and adaptability when done carefully; done carelessly, it creates its own complexity. |
| **Maintenance overhead** | Extra adapter code is justified only with multiple or changing integrations. |
| **Latency** | Another layer can add latency (usually negligible in-process; matters if adapters do extra serialization or hops). |

## Concepts

- **Application / domain core:** business logic. Receives commands and queries through ports; sends requests out through ports. Knows nothing about databases, HTTP, queues, or the cloud provider.
- **Port:** a technology-agnostic interface, defined by the application, that external actors use to talk to it (input / driving ports) or that the application uses to talk to the outside (output / driven ports). Like a USB port: any device with the right adapter works.
- **Adapter:** implements or calls a port using a specific technology. A REST adapter and a GraphQL adapter can both drive the same input port without affecting each other or the core. A DynamoDB adapter and an S3 adapter can both implement the same storage port.

Consequences:
- Swap a dependency by swapping the adapter.
- Test the core without provisioning infrastructure, by plugging in mocks or in-memory adapters.
- The core supplies data to a port; the adapter decides whether it goes to a database, a file system, or S3.

## Lambda + DynamoDB walkthrough (Python, from the guide)

Architecture: API Gateway REST API -> Lambda function (hexagonal internally) -> DynamoDB tables. The domain is a vaccination reservation system: a recipient reserves slots.

### 1. Domain model: pure business logic

```python
class Recipient:
    def __init__(self, recipient_id: str, email: str, first_name: str, last_name: str, age: int):
        self.__recipient_id = recipient_id
        self.__email = email
        self.__first_name = first_name
        self.__last_name = last_name
        self.__age = age
        self.__slots = []

    @property
    def recipient_id(self):
        return self.__recipient_id
    # ... other properties

    def are_slots_same_date(self, slot: "Slot") -> bool:
        return any(s.reservation_date == slot.reservation_date for s in self.__slots)

    def is_slot_counts_equal_or_over_two(self) -> bool:
        return len(self.__slots) >= 2

    # Body below is illustrative; the guide elides it.
    def add_reserve_slot(self, slot: "Slot") -> bool:
        if self.is_slot_counts_equal_or_over_two() or self.are_slots_same_date(slot):
            return False
        self.__slots.append(slot)
        slot.use_slot()
        return True
```

No imports of boto3, no HTTP, no JSON. Just rules: at most two slots, never two on the same date.

### 2. Input port: the use case

```python
class RecipientInputPort(IRecipientInputPort):
    def __init__(self, recipient_output_port: IRecipientOutputPort, slot_output_port: ISlotOutputPort):
        self.__recipient_output_port = recipient_output_port
        self.__slot_output_port = slot_output_port

    def make_reservation(self, recipient_id: str, slot_id: str) -> Status:
        # load through output ports
        recipient = self.__recipient_output_port.get_recipient_by_id(recipient_id)
        slot = self.__slot_output_port.get_slot_by_id(slot_id)
        if recipient is None or slot is None:
            return Status(400, "Request instance is not found.")

        # run domain logic
        added = recipient.add_reserve_slot(slot)

        # persist through output port
        if added:
            added = self.__recipient_output_port.add_reservation(recipient)
        return Status(200, "The recipient's reservation is added." if added
                           else "The recipient's reservation is NOT added!")
```

### 3. Output adapter: DynamoDB

```python
class DDBRecipientAdapter(IRecipientAdapter):
    def __init__(self):
        self.__table = boto3.resource("dynamodb").Table(table_name)

    def load(self, recipient_id: str) -> Recipient:
        response = self.__table.get_item(Key={"pk": pk_prefix + recipient_id})
        # ... map item -> Recipient

    def save(self, recipient: Recipient) -> bool:
        item = {
            "pk": pk_prefix + recipient.recipient_id,
            "email": recipient.email,
            "first_name": recipient.first_name,
            "last_name": recipient.last_name,
            "age": recipient.age,
            "slots": [],  # ... map slots
        }
        # ... put_item
```

### 4. Composition root and input adapter: the Lambda handler

```python
def get_recipient_input_port():
    # The only place that knows which concrete adapters are used.
    return RecipientInputPort(
        RecipientOutputPort(DDBRecipientAdapter()),
        SlotOutputPort(DDBSlotAdapter()),
    )

def lambda_handler(event, context):
    # Input adapter: translate API Gateway event -> port call -> HTTP response
    body = json.loads(event["body"])
    status = get_recipient_input_port().make_reservation(body["recipient_id"], body["slot_id"])
    return {"statusCode": status.status_code,
            "body": json.dumps({"message": status.message})}
```

### 5. Unit tests: no AWS required

```python
def test_add_slot_one(fixture_recipient, fixture_slot):
    target, slot = fixture_recipient, fixture_slot
    target.add_reserve_slot(slot)
    assert len(target.slots) == 1
    assert target.slots[0].slot_id == slot.slot_id
    assert target.slots[0].reservation_date == slot.reservation_date
    assert target.slots[0].location == slot.location
    assert target.slots[0].is_vacant is False

def test_cannot_append_slot_more_than_two(fixture_recipient, fixture_slot, fixture_slot_2, fixture_slot_3): ...
def test_cannot_append_same_date_slot(fixture_recipient, fixture_slot): ...
```

Input port tests inject fake output ports (in-memory dictionaries) instead of DynamoDB adapters.

Full sample: https://github.com/aws-samples/aws-lambda-domain-model-sample
Further reading: Alistair Cockburn, "Hexagonal architecture".

## Review checklist

- The domain package imports nothing from the cloud SDK, web framework, or ORM.
- Port interfaces are named by **purpose** (`RecipientRepository`, `NotificationSender`), not technology (`DynamoClient`).
- The Lambda handler (or controller) only parses input, calls one port, and formats output.
- Adapter wiring happens in one composition root.
- Domain and use-case tests run without network or infrastructure.
- Adapters are justified: there is more than one, or a credible plan to swap.

## Relationship to other skills

Hexagonal architecture is the same Dependency Rule idea as Clean Architecture and Onion Architecture: dependencies point inward toward the domain. Use the **clean-architecture** skill for layer-placement decisions, and **domain-driven-design** for deciding what each hexagon (subdomain) should contain.
