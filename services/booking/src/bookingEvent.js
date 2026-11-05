function bookingEvent(booking) {
  return {
    booking_id: booking.id,
    user_id: booking.user_id,
    user_email: booking.user_email,
    flight_id: booking.flight_id,
    flight_no: booking.flight_no,
    seat_id: booking.seat_id,
    amount: booking.amount,
    reason: booking.cancel_reason,
  };
}

function publicBooking(booking) {
  return {
    id: booking.id,
    flightId: booking.flight_id,
    flightNo: booking.flight_no,
    seatId: booking.seat_id,
    amount: booking.amount,
    status: booking.status,
    cancelReason: booking.cancel_reason,
    holdExpiresAt: booking.hold_expires_at,
    createdAt: booking.created_at,
  };
}

module.exports = { bookingEvent, publicBooking };
