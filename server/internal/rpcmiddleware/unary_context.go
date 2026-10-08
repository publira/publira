package rpcmiddleware

import (
	"context"
	"errors"
	"io"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
)

// UnaryRequestFunc sees a unary request message before the handler does. It
// calls next to run the handler, with the context the handler should get, or
// returns without calling it to refuse the call.
type UnaryRequestFunc func(ctx context.Context, spec connect.Spec, req proto.Message, next func(context.Context) error) error

// NewUnaryRequestInterceptor runs intercept on every unary call with its
// request message.
//
// A connect-go v2 interceptor wraps the call before anything is read, and the
// handler receives the message only once it has been given its context. A
// decision that depends on the message and changes the context — which tenant
// the request names, who the session belongs to — therefore has to receive the
// message itself, ahead of the handler, and hand the handler that same message
// when it asks for it. Streaming calls pass through untouched.
func NewUnaryRequestInterceptor(intercept UnaryRequestFunc) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			if spec.StreamType != connect.StreamTypeUnary {
				return next(ctx, spec, stream)
			}
			req, err := newRequestMessage(spec)
			if err != nil {
				return err
			}
			if err := stream.Receive(req); err != nil {
				return err
			}
			return intercept(ctx, spec, req, func(ctx context.Context) error {
				return next(ctx, spec, &receivedStream{ServerStream: stream, req: req})
			})
		}
	}
}

func newRequestMessage(spec connect.Spec) (proto.Message, error) {
	method, ok := spec.Schema.(protoreflect.MethodDescriptor)
	if !ok {
		return nil, connect.Errorf(connect.CodeInternal, "%s has no protobuf schema", spec.Procedure)
	}
	messageType, err := protoregistry.GlobalTypes.FindMessageByName(method.Input().FullName())
	if err != nil {
		return nil, connect.Errorf(connect.CodeInternal, "%s request type is not registered", spec.Procedure).WithCause(err)
	}
	return messageType.New().Interface(), nil
}

// receivedStream answers the handler's Receive with the message the
// interceptor already read off the wire.
type receivedStream struct {
	connect.ServerStream
	req      proto.Message
	consumed bool
}

func (s *receivedStream) Receive(msg any) error {
	if s.consumed {
		return io.EOF
	}
	dst, ok := msg.(proto.Message)
	if !ok {
		return errors.New("receive target is not a protobuf message")
	}
	s.consumed = true
	proto.Reset(dst)
	proto.Merge(dst, s.req)
	return nil
}

// UnaryContextBuilder builds a derived context from each unary request.
type UnaryContextBuilder func(ctx context.Context, spec connect.Spec, req proto.Message) (context.Context, error)

// NewUnaryContextBuilderInterceptor applies context building logic to any unary endpoint.
func NewUnaryContextBuilderInterceptor(builder UnaryContextBuilder) connect.ServerInterceptor {
	return NewUnaryRequestInterceptor(func(ctx context.Context, spec connect.Spec, req proto.Message, next func(context.Context) error) error {
		nextCtx, err := builder(ctx, spec, req)
		if err != nil {
			return err
		}
		return next(nextCtx)
	})
}
