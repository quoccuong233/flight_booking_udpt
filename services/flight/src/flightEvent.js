function flightEvent(flight, route) {
  return {
    id: flight.id,
    flight_no: flight.flight_no,
    airline: flight.airline,
    origin: route.origin,
    destination: route.destination,
    depart_at: flight.depart_at,
    arrive_at: flight.arrive_at,
    price: flight.price,
    total_seats: flight.total_seats,
    updated_at: flight.updated_at,
  };
}

module.exports = { flightEvent };
